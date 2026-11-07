import generate from '@babel/generator';
import * as parser from '@babel/parser';
import traverse, { type Binding, type NodePath, type Scope } from '@babel/traverse';
import * as t from '@babel/types';

import mappings, { type QrFunctionSpec } from './mappings';
import { addMapping, type IdentifierMapping } from '../../util/ast';

// dark-overlay -> DarkOverlay
const kebabToPascal = (name: string): string => name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

// unlike util/ast's getObjectKeys, this also picks up method-shorthand keys (`cls() {...}`,
// `onClick(e) {...}`) - Vue components lean on that syntax constantly for computed/methods,
// and those parse as ObjectMethod rather than ObjectProperty.
const getObjectKeys = (obj: t.ObjectExpression): string[] => obj.properties
    .filter((p): p is t.ObjectProperty | t.ObjectMethod => (t.isObjectProperty(p) || t.isObjectMethod(p)) && !p.computed)
    .map(p => p.key)
    .filter((k): k is t.Identifier => t.isIdentifier(k))
    .map(k => k.name);

// pulls the object literal a `data`/`computed`/`methods`/`watch` property points to, however
// it's shaped: data: () => ({...})   data: function() { return {...}; }   computed: {...}   methods: {...}   watch: {...}
// (a `watch` section is occasionally misspelled `watched` in the actual source itself - not a
// minifier artifact, a genuine typo in the game's own code - so that's accepted as an alias.)
const getSectionObject = (obj: t.ObjectExpression, section: 'data' | 'computed' | 'methods' | 'watch'): t.ObjectExpression | null => {
    const sectionKeyNames = section === 'watch' ? ['watch', 'watched'] : [section];

    const prop = obj.properties.find(p =>
        (t.isObjectProperty(p) || t.isObjectMethod(p)) &&
        !p.computed &&
        ((t.isIdentifier(p.key) && sectionKeyNames.includes(p.key.name)) || (t.isStringLiteral(p.key) && sectionKeyNames.includes(p.key.value)))
    );

    if (!prop) return null;

    if (section === 'computed' || section === 'methods' || section === 'watch') {
        if (t.isObjectProperty(prop) && t.isObjectExpression(prop.value)) return prop.value;
        return null;
    }

    // data() is a function; find the ObjectExpression it returns
    let fn: t.Function | null = null;

    if (t.isObjectMethod(prop)) fn = t.functionExpression(null, prop.params, prop.body, prop.generator, prop.async);
    else if (t.isObjectProperty(prop) && (t.isArrowFunctionExpression(prop.value) || t.isFunctionExpression(prop.value))) fn = prop.value;

    if (!fn) return null;

    if (t.isArrowFunctionExpression(fn) && !t.isBlockStatement(fn.body)) {
        return t.isObjectExpression(fn.body) ? fn.body : null;
    }

    if (t.isBlockStatement(fn.body)) {
        for (const stmt of fn.body.body) {
            if (t.isReturnStatement(stmt) && stmt.argument && t.isObjectExpression(stmt.argument)) return stmt.argument;
        }
    }

    return null;
};

// pulls the ObjectExpression a function returns, however it's shaped - `() => ({...})` or
// `function () { ...; return {...}; }` (the first `return` of an object literal counts). Used
// for mappings.ts' `topLevelFunctions` entries, whose target isn't a Vue component at all, just
// some plain top-level function that happens to build and return an options-shaped object.
const getReturnedObject = (fn: t.Function): t.ObjectExpression | null => {
    if (t.isArrowFunctionExpression(fn) && !t.isBlockStatement(fn.body)) {
        return t.isObjectExpression(fn.body) ? fn.body : null;
    }

    if (t.isBlockStatement(fn.body)) {
        for (const stmt of fn.body.body) {
            if (t.isReturnStatement(stmt) && stmt.argument && t.isObjectExpression(stmt.argument)) return stmt.argument;
        }
    }

    return null;
};

const getComponentKeys = (obj: t.ObjectExpression) => ({
    dataProps: (() => { const o = getSectionObject(obj, 'data'); return o ? getObjectKeys(o) : []; })(),
    computedProps: (() => { const o = getSectionObject(obj, 'computed'); return o ? getObjectKeys(o) : []; })(),
    methodProps: (() => { const o = getSectionObject(obj, 'methods'); return o ? getObjectKeys(o) : []; })(),
    watchProps: (() => { const o = getSectionObject(obj, 'watch'); return o ? getObjectKeys(o) : []; })()
});

const collectBindingIdentifiers = (binding: Binding): Set<t.Identifier> => {
    const oldName = binding.identifier.name;
    const ids = new Set<t.Identifier>([binding.identifier]);

    for (const ref of binding.referencePaths) {
        if (!t.isIdentifier(ref.node)) continue;

        ids.add(ref.node);
        if (t.isObjectProperty(ref.parent) && ref.parent.shorthand && ref.parent.value === ref.node) ref.parent.shorthand = false;
    }

    for (const violation of binding.constantViolations)
        for (const id of Object.values(t.getBindingIdentifiers(violation.node, false, false, false)).flat())
            if (id.name === oldName) ids.add(id);

    return ids;
};

const applyBindingRenames = (items: { binding: Binding; newName: string }[]) => {
    const prepared = items.map(({ binding, newName }) => ({ binding, newName, oldName: binding.identifier.name, ids: collectBindingIdentifiers(binding) }));

    for (const { binding, oldName } of prepared)
        if (binding.scope.bindings[oldName] === binding) binding.scope.removeOwnBinding(oldName);

    for (const { binding, newName, ids } of prepared) {
        for (const id of ids) id.name = newName;
        binding.scope.bindings[newName] = binding;
    }
};

const buildMappedFile = async (inputJS: string): Promise<string> => {
    let lastBench = Date.now();
    const benchmark = (label: string) => {
        const now = Date.now();
        console.log(`${label}: ${((now - lastBench) / 1000).toFixed(3)}s`);
        lastBench = now;
    };

    const ast = parser.parse(inputJS, { sourceType: 'module' });
    benchmark('parse');

    // the whole file is normally wrapped in a single IIFE: `(() => { ...everything... })();`
    // find that wrapper (if any) so we only look at genuine top-level `var`s below, and don't
    // get confused by same-named locals declared deep inside individual render functions
    // (single-letter names like `e`/`t`/`h` get reused constantly in there).
    let iifeFnPath: NodePath<t.Function> | null = null;

    traverse(ast, {
        Program(path) {
            const first = path.get('body')[0];
            if (!first || !first.isExpressionStatement()) return;

            const expr = first.get('expression');
            if (!expr.isCallExpression()) return;

            const callee = expr.get('callee');
            if (callee.isArrowFunctionExpression() || callee.isFunctionExpression()) iifeFnPath = callee;
        }
    });

    // name -> the VariableDeclarator path for every genuine top-level `var X = {...}` (init is
    // an object literal directly - what the key-matching pass needs to inspect)
    const topLevel = new Map<string, NodePath<t.VariableDeclarator>>();

    // name -> the VariableDeclarator path for every genuine top-level `var X = ...;`, regardless
    // of what it's initialized to - e.g. `var ze = Ke(Le);` (a factory call, so no local
    // data/computed/methods to key-match against) is still a fine rename target for the
    // registry/`window.*` passes, which only need a name and a scope, not an object shape.
    const topLevelVars = new Map<string, NodePath<t.VariableDeclarator>>();

    // name -> the FunctionDeclaration path for every genuine top-level `function X() {...}`
    // (e.g. `function Me() { return Object.assign({}, Ee); }`) - these don't have an
    // ObjectExpression init like the components do, so they're tracked separately, but a
    // `window.readableName = X;` assignment can still name them just the same.
    const topLevelFunctions = new Map<string, NodePath<t.FunctionDeclaration>>();

    const isTopLevelPath = (path: NodePath): boolean => {
        const fnParent = path.getFunctionParent();
        return iifeFnPath ? fnParent?.node === iifeFnPath.node : fnParent === null;
    };

    traverse(ast, {
        VariableDeclarator(path) {
            if (!t.isIdentifier(path.node.id)) return;
            if (!path.node.init) return;
            if (!isTopLevelPath(path)) return;

            topLevelVars.set(path.node.id.name, path);
            if (t.isObjectExpression(path.node.init)) topLevel.set(path.node.id.name, path);
        },
        FunctionDeclaration(path) {
            if (!path.node.id) return;
            if (!isTopLevelPath(path)) return;

            topLevelFunctions.set(path.node.id.name, path);
        }
    });

    benchmark('top-level scan');

    const variableRenames: IdentifierMapping = {};

    // section ObjectExpression node (the `computed: {...}`/`methods: {...}` object of a
    // component, a `window.*Methods`/`window.*Computed` helper object, or a plain
    // variableRemaps object like `localStorageUtil`) -> its param map. Populated by pass 0
    // below and again by pass 6 further down; consumed by the single traversal at the end of
    // pass 6.
    const sectionParamsByObjectNode = new Map<t.ObjectExpression, Record<string, string[]>>();

    // renames a function's first N params, positionally, to `names` - used by variableRemaps'
    // `params` (pass 0), the render function/renderList passes further down, and mappings.ts'
    // `topLevelFunctions` (pass 6b).
    const renameLeadingParams = (fnPath: NodePath<t.Function>, names: string[]) => {
        const params = fnPath.get('params') as NodePath<t.Node>[];

        params.slice(0, names.length).forEach((paramPath, i) => {
            if (!paramPath.isIdentifier()) return; // skip destructure/rest/default params

            const oldName = paramPath.node.name;
            const newName = names[i];
            if (oldName === newName) return;

            const binding = fnPath.scope.getBinding(oldName);
            if (!binding) return;

            // don't rename into a name that's already bound to something else in scope
            const existing = fnPath.scope.getBinding(newName);
            if (existing && existing !== binding) return;

            fnPath.scope.rename(oldName, newName);
        });
    };

    // resolves a genuine top-level var/function name to the `t.Function` node backing it,
    // whichever declaration flavor it is - `function foo() {}` or `var foo = function/() => {}`.
    // Used by pass 0's `params` and pass 6b's `topLevelFunctions`, both of which rename a plain
    // (non-component) function's own leading params directly.
    const getTopLevelFunctionPath = (name: string): NodePath<t.Function> | null => {
        const fnDeclPath = topLevelFunctions.get(name);
        if (fnDeclPath) return fnDeclPath;

        const varDeclPath = topLevelVars.get(name);
        const init = varDeclPath?.node.init;
        if (init && (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init))) {
            return varDeclPath!.get('init') as NodePath<t.Function>;
        }

        return null;
    };

    // pass 0: misc `var X = Y;` remaps from mappings.ts, keyed off a regex captured against the
    // pristine input text (Y might be anything - an object, a function, a primitive - this
    // isn't about Vue components at all). The regex only tells us the OLD minified name; we
    // still insist it resolve to a genuine top-level var/function before touching it, and the
    // actual rename always goes through that declaration's own scope - never a blind
    // find-and-replace of every identifier sharing that (often one- or two-letter) name.
    for (const remap of mappings.variableRemaps) {
        const match = remap.regex.exec(inputJS);
        const capturedName = match?.[1];

        if (!capturedName) {
            console.log(`variableRemap '${remap.name}' did not match anything`);
            continue;
        }

        if (Object.hasOwn(variableRenames, capturedName)) continue; // already claimed by something else

        if (!topLevelVars.has(capturedName) && !topLevelFunctions.has(capturedName)) {
            console.log(`variableRemap '${remap.name}' matched '${capturedName}', but that's not a top-level var/function - skipped`);
            continue;
        }

        addMapping(variableRenames, capturedName, remap.name);

        // this remap also carries known parameter names for the (flat, un-nested) methods
        // living directly on the object it points to - e.g. `localStorageUtil`'s
        // `getItem(e)`/`setItem(e, t)`. Only object literals qualify; a remap pointing at a
        // function declaration has no such methods to rename.
        if (remap.objectParameters) {
            const init = topLevelVars.get(capturedName)?.node.init;
            if (init && t.isObjectExpression(init)) sectionParamsByObjectNode.set(init, remap.objectParameters);
            else console.log(`variableRemap '${remap.name}' has objectParameters but '${capturedName}' isn't an object literal - skipped`);
        }

        // this remap also carries known names for the pointed-at function's OWN leading params -
        // e.g. `getRealParent(e)` -> `getRealParent(instance)`. Applies to a plain function
        // (declaration or expression); an object literal has no params of its own to rename.
        if (remap.params) {
            const fnPath = getTopLevelFunctionPath(capturedName);
            if (fnPath) renameLeadingParams(fnPath, remap.params);
            else console.log(`variableRemap '${remap.name}' has params but '${capturedName}' isn't a function - skipped`);
        }
    }

    benchmark('pass 0');

    // pass 1: find registry objects that map component names straight to their variable,
    // e.g. `var Ee = { "dark-overlay": e, "light-overlay": t, ... };` - these are unambiguous.
    // the registry var itself gets renamed too, once we know it really is one: componentRegistry1,
    // componentRegistry2, ... (there can be more than one - e.g. one for globally-registered
    // components, another for a smaller locally-registered set).
    let componentRegistryIdx = 0;

    for (const [registryVarName, registryPath] of topLevel) {
        const registryObj = registryPath.node.init as t.ObjectExpression;
        const entries = registryObj.properties.filter((p): p is t.ObjectProperty => t.isObjectProperty(p) && t.isIdentifier(p.value));
        if (entries.length < 5) continue; // heuristic: registries reference many components

        let matched = 0;

        for (const prop of entries) {
            const componentName = t.isIdentifier(prop.key) && !prop.computed
                ? prop.key.name
                : t.isStringLiteral(prop.key) ? prop.key.value : null;

            if (!componentName) continue;

            const varName = (prop.value as t.Identifier).name;
            if (!topLevelVars.has(varName)) continue;

            addMapping(variableRenames, varName, kebabToPascal(componentName));
            matched++;
        }

        if (matched > 0) {
            componentRegistryIdx++;
            const registryNewName = `componentRegistry${componentRegistryIdx}`;
            addMapping(variableRenames, registryVarName, registryNewName);
        }
    }

    benchmark('pass 1');

    // pass 2: `window.readableName = obfuscatedVar;` assignments (usually near the end of the
    // file) directly name several top-level helper objects, e.g.
    // `window.rootComputed = ut;` -> rename `ut` to `rootComputed`. Just as unambiguous as the
    // component registry, so treat it the same way - only ever rename genuine top-level vars.
    traverse(ast, {
        AssignmentExpression(path) {
            const { node } = path;

            if (
                !t.isMemberExpression(node.left) ||
                !t.isIdentifier(node.left.object) ||
                node.left.object.name !== 'window' ||
                node.left.computed ||
                !t.isIdentifier(node.left.property) ||
                !t.isIdentifier(node.right)
            ) return;

            const readableName = node.left.property.name;
            const varName = node.right.name;

            if (!topLevelVars.has(varName) && !topLevelFunctions.has(varName)) return;
            if (Object.hasOwn(variableRenames, varName)) return;

            addMapping(variableRenames, varName, readableName);
        }
    });

    benchmark('pass 2');
    console.log(`mapped ${Object.keys(variableRenames).length} component variable(s) after window.* pass`);

    // pass 3: for every remaining top-level object that looks like a component (has a `render`
    // key, or any data/computed/methods/watch), match its keys against the vue2 mappings to
    // recover its name. Runs twice: a strict pass first (minScore 2), then - only against
    // whatever's still unmatched - a lenient retry (minScore 1) to catch components whose keys
    // shifted a little since vue2 and only share one property now. Both still require a
    // unique best match; the lenient retry just accepts a lower bar to be that best match.
    const matchRemainingComponents = (minScore: number): number => {
        let matchedCount = 0;

        for (const [varName, declPath] of topLevel) {
            if (Object.hasOwn(variableRenames, varName)) continue;

            const obj = declPath.node.init as t.ObjectExpression;

            const hasRender = obj.properties.some(p =>
                (t.isObjectProperty(p) || t.isObjectMethod(p)) && !p.computed &&
                t.isIdentifier(p.key) && p.key.name === 'render'
            );

            const { dataProps, computedProps, methodProps, watchProps } = getComponentKeys(obj);
            if (!hasRender && dataProps.length === 0 && computedProps.length === 0 && methodProps.length === 0 && watchProps.length === 0) continue;

            const targetKeys = new Set([...dataProps, ...computedProps, ...methodProps, ...watchProps]);
            if (targetKeys.size === 0) continue;

            let bestMatch: { name: string; score: number } | null = null;
            let secondBestScore = 0;

            for (const mapping of mappings.components) {
                const mappingKeys = new Set([
                    ...(mapping.dataProps ?? []),
                    ...(mapping.computedProps ?? []),
                    ...(mapping.methodProps ?? []),
                    ...(mapping.watchProps ?? [])
                ]);

                let score = 0;
                for (const key of mappingKeys) if (targetKeys.has(key)) score++;

                if (!bestMatch || score > bestMatch.score) {
                    secondBestScore = bestMatch?.score ?? 0;
                    bestMatch = { name: mapping.name, score };
                } else if (score > secondBestScore) secondBestScore = score;
            }

            // require a confident, unambiguous match
            if (bestMatch && bestMatch.score >= minScore && bestMatch.score > secondBestScore) {
                addMapping(variableRenames, varName, kebabToPascal(bestMatch.name));
                matchedCount++;
            }
        }

        return matchedCount;
    };

    matchRemainingComponents(2);
    console.log(`mapped ${Object.keys(variableRenames).length} component variable(s) after strict key match`);

    benchmark('pass 3 strict');
    const lenientMatched = matchRemainingComponents(1);
    benchmark('pass 3 lenient');
    console.log(`lenient key match caught ${lenientMatched} more component variable(s)`);

    // pass 3d: manual fallback for components too generic to key-match at all (few/no
    // distinctive data/computed/methods/watch names) - if a literal substring from
    // mappings.manualComponents shows up in the render function's generated source (usually a
    // hardcoded asset path or a chunk of loc text baked into the template), that's enough.
    let manualMatched = 0;

    for (const [varName, declPath] of topLevel) {
        if (Object.hasOwn(variableRenames, varName)) continue;

        const obj = declPath.node.init as t.ObjectExpression;
        const renderProp = obj.properties.find((p): p is t.ObjectProperty | t.ObjectMethod =>
            (t.isObjectProperty(p) || t.isObjectMethod(p)) && !p.computed &&
            t.isIdentifier(p.key) && p.key.name === 'render'
        );
        if (!renderProp) continue;

        const renderNode = t.isObjectMethod(renderProp) ? renderProp : renderProp.value;
        const renderSource = generate(renderNode, { compact: true }).code;

        for (const manual of mappings.manualComponents) {
            const newName = kebabToPascal(manual.name);
            if (Object.values(variableRenames).includes(newName)) continue; // already assigned elsewhere
            if (!renderSource.includes(manual.renderContains)) continue;

            addMapping(variableRenames, varName, newName);
            manualMatched++;
            break;
        }
    }

    benchmark('pass 3d');
    console.log(`manual renderContains match caught ${manualMatched} more component variable(s)`);
    console.log(`mapped ${Object.keys(variableRenames).length} component variable(s)`);

    // log anything from mappings.ts that never ended up matching any variable, by any pass -
    // useful for spotting vue2 components that got renamed/removed/merged since the mapping
    // data was captured, or that this file just doesn't happen to contain. components known to
    // be absent from this particular build are excluded so they don't cry wolf every run.
    const usedNewNames = new Set(Object.values(variableRenames));
    const unmatchedMappings = mappings.components.filter(m =>
        !usedNewNames.has(kebabToPascal(m.name)) && !mappings.knownAbsent.includes(m.name)
    );

    if (unmatchedMappings.length > 0) {
        console.log(`${unmatchedMappings.length} mapping(s) unmatched: ${unmatchedMappings.map(m => m.name).join(', ')}`);
    } else {
        console.log('every mapping matched a variable');
    }

    // pass 3c: component-factory helpers - `var Ke = e => ({ render: e, props: [...], ... });`
    // or `function Re(e) { return { render: e, ... }; }` - the same options object (methods,
    // computed, watch, everything but render) shared by more than one component, e.g. both
    // `var SsButton = Ke(Le);` and `var SsButtonDropdown = Ke(Ne);`. Once we already know a
    // factory's caller's name (from an earlier pass), we know what to call the render-core
    // argument too: `Le` -> `SsButtonCore`. The factory itself just gets a running index,
    // since there can be several distinct ones (`wrapComponent1`, `wrapComponent2`, ...).
    // returns the object literal a component factory returns (`e => ({ render: e, ... })`'s
    // `{ render: e, ... }`), or null if `fn` isn't shaped like one at all.
    const getFactoryBodyObject = (fn: t.Function): t.ObjectExpression | null => {
        if (fn.params.length !== 1 || !t.isIdentifier(fn.params[0])) return null;
        const paramName = fn.params[0].name;

        let bodyObj: t.ObjectExpression | null = null;
        if (t.isArrowFunctionExpression(fn) && !t.isBlockStatement(fn.body)) {
            if (t.isObjectExpression(fn.body)) bodyObj = fn.body;
        } else if (t.isBlockStatement(fn.body)) {
            for (const stmt of fn.body.body) {
                if (t.isReturnStatement(stmt) && stmt.argument && t.isObjectExpression(stmt.argument)) {
                    bodyObj = stmt.argument;
                    break;
                }
            }
        }
        if (!bodyObj) return null;

        const isFactoryShaped = bodyObj.properties.some(p =>
            t.isObjectProperty(p) && !p.computed &&
            t.isIdentifier(p.key) && p.key.name === 'render' &&
            t.isIdentifier(p.value) && p.value.name === paramName
        );

        return isFactoryShaped ? bodyObj : null;
    };

    const isComponentFactory = (fn: t.Function): boolean => getFactoryBodyObject(fn) !== null;

    const factoryNames = new Map<string, string>(); // old factory var/function name -> new name (assigned lazily, on first use)
    let wrapComponentIdx = 0;

    // old factory var/function name -> the shared options object every component built through
    // it actually has its methods/computed/watch on (`SsButton`/`SsButtonDropdown` both call
    // `wrapComponent1(...)`, so this is the ONE object literal pass 6 needs for either of them -
    // it's not per-component, just per-factory).
    const factoryBodyObjects = new Map<string, t.ObjectExpression>();

    // old names of every render-core var (`Le`, `Ne`, ...) - these hold the actual render
    // function passed into a factory, so pass 7 needs to rename their leading params too, even
    // though they're never directly sitting in a literal `render:` property.
    const renderCoreOldNames = new Set<string>();

    for (const [name, declPath] of topLevelVars) {
        const init = declPath.node.init;
        if (!init || (!t.isArrowFunctionExpression(init) && !t.isFunctionExpression(init))) continue;

        const bodyObj = getFactoryBodyObject(init);
        if (!bodyObj) continue;

        factoryNames.set(name, '');
        factoryBodyObjects.set(name, bodyObj);
    }
    for (const [name, declPath] of topLevelFunctions) {
        const bodyObj = getFactoryBodyObject(declPath.node);
        if (!bodyObj) continue;

        factoryNames.set(name, '');
        factoryBodyObjects.set(name, bodyObj);
    }

    // factory's NEW name (`wrapComponent1`, ...) -> its shared body object - by the time pass 6
    // runs, every reference to the factory (including the call site itself) has already been
    // renamed by the scope-aware rename pass below, so `factoryBodyObjects` (keyed by the OLD
    // name) is no longer reachable from there; this is.
    const factoryBodyObjectsByNewName = new Map<string, t.ObjectExpression>();

    for (const [varName, declPath] of topLevelVars) {
        const init = declPath.node.init;
        if (!init || !t.isCallExpression(init)) continue;
        if (!t.isIdentifier(init.callee) || !factoryNames.has(init.callee.name)) continue;
        if (init.arguments.length !== 1 || !t.isIdentifier(init.arguments[0])) continue;

        const factoryOldName = init.callee.name;
        const coreOldName = init.arguments[0].name;
        if (!topLevelVars.has(coreOldName)) continue;

        if (!factoryNames.get(factoryOldName)) {
            wrapComponentIdx++;
            const factoryNewName = `wrapComponent${wrapComponentIdx}`;
            factoryNames.set(factoryOldName, factoryNewName);
            addMapping(variableRenames, factoryOldName, factoryNewName);
        }

        const factoryBodyObj = factoryBodyObjects.get(factoryOldName);
        if (factoryBodyObj) factoryBodyObjectsByNewName.set(factoryNames.get(factoryOldName)!, factoryBodyObj);

        const resolvedCallerName = variableRenames[varName];
        if (resolvedCallerName && !Object.hasOwn(variableRenames, coreOldName)) {
            addMapping(variableRenames, coreOldName, `${resolvedCallerName}Core`);
        }

        renderCoreOldNames.add(coreOldName);
    }

    benchmark('pass 3c');

    // scope-aware rename: only touches references bound to this specific top-level declaration,
    // leaving same-named locals/params deep inside unrelated render functions untouched.
    const topLevelRenames: { binding: Binding; newName: string }[] = [];

    for (const [oldName, newName] of Object.entries(variableRenames)) {
        const declPath = topLevelVars.get(oldName) ?? topLevelFunctions.get(oldName);
        if (!declPath) continue;

        const binding = declPath.scope.getBinding(oldName);
        if (binding) topLevelRenames.push({ binding, newName });
    }

    applyBindingRenames(topLevelRenames);

    benchmark('top-level renames');

    // pass 4: unalias `const { propName: alias } = SomeObject;`-style destructures. Property
    // names are never minified (only the local alias is), e.g. `const { vShow: e } = Vue;` ->
    // `const { vShow } = Vue;` with every `e` in that scope renamed to `vShow`. Scope-aware, so
    // it only touches the alias where it was actually bound.
    traverse(ast, {
        ObjectPattern(path) {
            for (const prop of path.node.properties) {
                if (!t.isObjectProperty(prop) || prop.computed) continue;
                if (!t.isIdentifier(prop.key) || !t.isIdentifier(prop.value)) continue;
                if (prop.key.name === prop.value.name) continue;

                const aliasName = prop.value.name;
                const originalName = prop.key.name;

                const binding = path.scope.getBinding(aliasName);
                if (!binding) continue;

                // don't rename into a name that's already bound to something else in scope
                const existing = path.scope.getBinding(originalName);
                if (existing && existing !== binding) continue;

                path.scope.rename(aliasName, originalName);
                prop.shorthand = true;
            }
        }
    });

    benchmark('pass 4');

    // pass 5: `const c = resolveComponent("social-promo");` -> name the local var after what
    // it actually resolves to, e.g. `SocialPromoComponent` (and `resolveDirective("lazyload")`
    // -> `LazyloadDirective`, same idea). Relies on pass 4 having already un-aliased
    // `resolveComponent`/`resolveDirective` themselves wherever destructured from Vue.
    const resolveCalleeSuffix: Record<string, string> = {
        resolveComponent: 'Component',
        resolveDirective: 'Directive'
    };

    traverse(ast, {
        VariableDeclarator(path) {
            if (!t.isIdentifier(path.node.id)) return;
            if (!t.isCallExpression(path.node.init)) return;

            const { callee, arguments: args } = path.node.init;
            if (!t.isIdentifier(callee) || !Object.hasOwn(resolveCalleeSuffix, callee.name)) return;
            if (!args[0] || !t.isStringLiteral(args[0])) return;

            const oldName = path.node.id.name;
            const newName = `${kebabToPascal(args[0].value)}${resolveCalleeSuffix[callee.name]}`;
            if (oldName === newName) return;

            const binding = path.scope.getBinding(oldName);
            if (!binding) return;

            // don't rename into a name that's already bound to something else in scope
            const existing = path.scope.getBinding(newName);
            if (existing && existing !== binding) return;

            path.scope.rename(oldName, newName);
        }
    });

    benchmark('pass 5');

    // pass 6: for every component var we successfully named, also recover its `computed`
    // getters'/`methods`'/`watch`ers' parameter names from vue2 wherever the arity matches
    // exactly - a mismatched arity (a param added/removed since) just gets skipped instead of
    // guessed at.
    const pascalToMapping = new Map(mappings.components.map(m => [kebabToPascal(m.name), m]));

    for (const [oldName, newName] of Object.entries(variableRenames)) {
        const mapping = pascalToMapping.get(newName);
        if (!mapping) continue;

        // usually a plain `var Foo = {...};` - but a component built through a factory never
        // lands in `topLevel` itself (its init is a CallExpression, not an ObjectExpression), so
        // its methods/computed/watch actually live on the factory's returned object instead.
        // Two flavors: a shared, hoisted factory referenced by name (`var SsButton =
        // wrapComponent1(SsButtonCore);`), or a one-off inline factory only this component uses
        // (`var MusicWidget = (e => ({ render: e, ... }))(MusicWidgetCore);`).
        let obj = topLevel.get(oldName)?.node.init as t.ObjectExpression | undefined;

        if (!obj) {
            const init = topLevelVars.get(oldName)?.node.init;
            if (init && t.isCallExpression(init)) {
                if (t.isIdentifier(init.callee)) obj = factoryBodyObjectsByNewName.get(init.callee.name);
                else if (t.isArrowFunctionExpression(init.callee) || t.isFunctionExpression(init.callee)) obj = getFactoryBodyObject(init.callee) ?? undefined;
            }
        }

        if (!obj) continue;

        if (mapping.computedParams) {
            const sectionObj = getSectionObject(obj, 'computed');
            if (sectionObj) sectionParamsByObjectNode.set(sectionObj, mapping.computedParams);
        }
        if (mapping.methodParams) {
            const sectionObj = getSectionObject(obj, 'methods');
            if (sectionObj) sectionParamsByObjectNode.set(sectionObj, mapping.methodParams);
        }
        if (mapping.watchParams) {
            const sectionObj = getSectionObject(obj, 'watch');
            if (sectionObj) sectionParamsByObjectNode.set(sectionObj, mapping.watchParams);
        }
    }

    // same idea, but for the flat `window.*Methods`/`window.*Computed` helper objects (e.g.
    // `var st = { chwOnClick(e) {...}, ... };` named `chwMethods` by the `window.*` pass) -
    // these ARE the methods/computed dict themselves, not wrapped in their own sub-object.
    for (const windowGroup of mappings.windowGroups) {
        const paramsMap = { ...(windowGroup.methodParams ?? {}), ...(windowGroup.computedParams ?? {}) };
        if (Object.keys(paramsMap).length === 0) continue;

        const oldName = Object.entries(variableRenames).find(([, newName]) => newName === windowGroup.name)?.[0];
        if (!oldName) continue;

        const declPath = topLevel.get(oldName);
        if (!declPath) continue;

        sectionParamsByObjectNode.set(declPath.node.init as t.ObjectExpression, paramsMap);
    }

    // pass 6b: `mappings.topLevelFunctions` - plain top-level functions that aren't Vue
    // components at all (no vue2 dataProps/computedProps/etc to key-match against), but are
    // still worth naming their own params, e.g. `buildVueOptions(e)` -> `buildVueOptions(langCode)`.
    // `name` is whatever readable name an earlier pass (usually the `window.*` pass) already
    // resolved the function to; `params` renames its own leading params directly, while
    // `methodParams`/`computedParams`/`watchParams` reach into the ObjectExpression it *returns*
    // (e.g. the root app options object `buildVueOptions` builds) the same way a component's do.
    for (const topLevelFn of mappings.topLevelFunctions) {
        const oldName = Object.entries(variableRenames).find(([, newName]) => newName === topLevelFn.name)?.[0];
        if (!oldName) continue;

        const fnPath = getTopLevelFunctionPath(oldName);
        if (!fnPath) continue;

        if (topLevelFn.params) renameLeadingParams(fnPath, topLevelFn.params);

        if (topLevelFn.methodParams || topLevelFn.computedParams || topLevelFn.watchParams) {
            const returnedObj = getReturnedObject(fnPath.node);
            if (!returnedObj) continue;

            if (topLevelFn.computedParams) {
                const sectionObj = getSectionObject(returnedObj, 'computed');
                if (sectionObj) sectionParamsByObjectNode.set(sectionObj, topLevelFn.computedParams);
            }
            if (topLevelFn.methodParams) {
                const sectionObj = getSectionObject(returnedObj, 'methods');
                if (sectionObj) sectionParamsByObjectNode.set(sectionObj, topLevelFn.methodParams);
            }
            if (topLevelFn.watchParams) {
                const sectionObj = getSectionObject(returnedObj, 'watch');
                if (sectionObj) sectionParamsByObjectNode.set(sectionObj, topLevelFn.watchParams);
            }
        }
    }

    // pass 6c: `mappings.accessorParams` - getter/setter pairs anywhere in the file, keyed by
    // `"get <name>"`/`"set <name>"`. These commonly sit deep inside a plain data object (e.g.
    // `vueData.equip`'s `get/set showingItems`) with no enclosing component/topLevelFunction
    // section to hang a param map off of, so this just walks the whole tree once instead.
    if (Object.keys(mappings.accessorParams).length > 0) {
        traverse(ast, {
            ObjectMethod(path) {
                if (path.node.kind !== 'get' && path.node.kind !== 'set') return;
                if (path.node.computed || !t.isIdentifier(path.node.key)) return;

                const names = mappings.accessorParams[`${path.node.kind} ${path.node.key.name}`];
                if (names) renameLeadingParams(path, names);
            }
        });
    }

    benchmark('pass 6/6b/6c collect');

    const applyParamRename = (fnPath: NodePath<t.Function>, key: string | null, paramsMap: Record<string, string[]>) => {
        if (!key) return;

        const newParamNames = paramsMap[key];
        if (!newParamNames) return;

        const params = fnPath.get('params') as NodePath<t.Node>[];
        // lenient on arity: allow the current function to have fewer params than vue2 did (a
        // trailing unused one may have been dropped since) - just never guess a name for a
        // param vue2 never had, i.e. never rename more params than we have names for.
        if (params.length > newParamNames.length) return;

        params.forEach((paramPath, i) => {
            // a default param (`t = ANALYTICS.CATEGORY`) is an AssignmentPattern whose `.left`
            // is the actual identifier being bound - unwrap to that so it renames like any
            // other param instead of being skipped alongside genuine destructure/rest params.
            const identifierPath = paramPath.isAssignmentPattern() ? paramPath.get('left') : paramPath;
            if (!identifierPath.isIdentifier()) return; // skip destructure/rest params

            const oldParamName = identifierPath.node.name;
            const newParamName = newParamNames[i];
            if (oldParamName === newParamName) return;

            const binding = fnPath.scope.getBinding(oldParamName);
            if (!binding) return;

            // don't rename into a name that's already bound to something else in scope
            const existing = fnPath.scope.getBinding(newParamName);
            if (existing && existing !== binding) return;

            fnPath.scope.rename(oldParamName, newParamName);
        });
    };

    if (sectionParamsByObjectNode.size > 0) {
        traverse(ast, {
            ObjectMethod(path) {
                if (path.node.computed) return;

                const parent = path.parentPath.node;
                if (!t.isObjectExpression(parent)) return;

                const paramsMap = sectionParamsByObjectNode.get(parent);
                if (!paramsMap) return;

                const key = t.isIdentifier(path.node.key) ? path.node.key.name : t.isStringLiteral(path.node.key) ? path.node.key.value : null;
                applyParamRename(path, key, paramsMap);
            },
            ObjectProperty(path) {
                if (path.node.computed) return;

                const parent = path.parentPath.node;
                if (!t.isObjectExpression(parent)) return;

                const paramsMap = sectionParamsByObjectNode.get(parent);
                if (!paramsMap) return;

                const key = t.isIdentifier(path.node.key) ? path.node.key.name : t.isStringLiteral(path.node.key) ? path.node.key.value : null;
                const valuePath = path.get('value');

                if (valuePath.isFunctionExpression() || valuePath.isArrowFunctionExpression()) {
                    applyParamRename(valuePath, key, paramsMap);
                    return;
                }

                // long-form watcher: `eggs: { handler(e) {...}, immediate: true }` - same
                // rename, just one level deeper, on the nested `handler` rather than `eggs`
                // itself (which here points at a plain options object, not a function).
                if (!valuePath.isObjectExpression()) return;

                for (const handlerPath of valuePath.get('properties') as NodePath<t.Node>[]) {
                    if (handlerPath.isObjectMethod() && !handlerPath.node.computed && t.isIdentifier(handlerPath.node.key) && handlerPath.node.key.name === 'handler') {
                        applyParamRename(handlerPath, key, paramsMap);
                        break;
                    }

                    if (handlerPath.isObjectProperty() && !handlerPath.node.computed && t.isIdentifier(handlerPath.node.key) && handlerPath.node.key.name === 'handler') {
                        const handlerValuePath = handlerPath.get('value');
                        if (handlerValuePath.isFunctionExpression() || handlerValuePath.isArrowFunctionExpression()) applyParamRename(handlerValuePath, key, paramsMap);
                        break;
                    }
                }
            }
        });
    }

    benchmark('pass 6 apply');

    // pass 7: the compiled Vue 3 render function - `render: function () { ...consts...; return
    // function (a, b) { ... }; }()`, or occasionally just `render(a, b) {...}` with no wrapper -
    // always takes `(ctx, cache)` positionally. Purely structural, so it applies to every
    // render function regardless of whether we managed to name its component.
    const renderParamNames = ['ctx', 'cache'];

    // unwraps a 0-arg IIFE (`(function(){...})()`) to find the function it actually returns -
    // that's the real render function when the outer one is just a closure for hoisted consts.
    // also resolves `render: someVar` (e.g. the root app's `render: renderMain, components: ...`)
    // back to wherever `someVar` was actually declared, instead of only handling an inline
    // function/IIFE sitting directly in the `render:` property.
    const findRenderFunctionPath = (valuePath: NodePath): NodePath<t.Function> | null => {
        let current: NodePath = valuePath;

        if (current.isIdentifier()) {
            const binding = current.scope.getBinding(current.node.name);
            if (!binding) return null;

            if (binding.path.isVariableDeclarator()) {
                const init = binding.path.get('init');
                if (!init.node) return null;
                current = init as NodePath<t.Expression>;
            } else if (binding.path.isFunctionDeclaration()) {
                return binding.path;
            } else if (binding.kind === 'param') {
                // a param of an immediately-invoked, inline component-factory arrow/function,
                // e.g. `(e => ({ render: e, ... }))(actualRenderFn)` (same shape pass 3c hoists
                // into `Ke`/`Le`-style named vars, just inlined here instead since it's only
                // used once) - resolve straight to the argument actually passed for it.
                const fnPath = binding.path.parentPath;
                if (!fnPath || (!fnPath.isArrowFunctionExpression() && !fnPath.isFunctionExpression())) return null;
                if (!isComponentFactory(fnPath.node)) return null;

                const paramIndex = fnPath.node.params.indexOf(binding.path.node as t.Identifier);
                const callPath = fnPath.parentPath;
                if (paramIndex === -1 || !callPath.isCallExpression() || callPath.node.callee !== fnPath.node) return null;

                const argPath = callPath.get('arguments')[paramIndex];
                if (!argPath || !argPath.isExpression()) return null;

                current = argPath;
            } else return null;
        }

        if (current.isCallExpression() && current.node.arguments.length === 0) {
            const callee = current.get('callee');
            if (callee.isFunctionExpression() || callee.isArrowFunctionExpression()) current = callee;
        }

        if (!current.isFunctionExpression() && !current.isArrowFunctionExpression()) return null;

        const fnPath = current as NodePath<t.Function>;
        if (fnPath.node.params.length > 0) return fnPath;

        // 0-param wrapper - find the function it returns
        const bodyPath = fnPath.get('body') as NodePath<t.Node>;

        if (!bodyPath.isBlockStatement()) {
            return bodyPath.isFunctionExpression() || bodyPath.isArrowFunctionExpression() ? bodyPath as NodePath<t.Function> : null;
        }

        for (const stmtPath of bodyPath.get('body')) {
            if (!stmtPath.isReturnStatement()) continue;

            const argPath = stmtPath.get('argument');
            if (argPath.isFunctionExpression() || argPath.isArrowFunctionExpression()) return argPath;
        }

        return null;
    };

    traverse(ast, {
        ObjectMethod(path) {
            if (path.node.computed) return;
            if (!t.isIdentifier(path.node.key) || path.node.key.name !== 'render') return;

            renameLeadingParams(path, renderParamNames);
        },
        ObjectProperty(path) {
            if (path.node.computed) return;
            if (!t.isIdentifier(path.node.key) || path.node.key.name !== 'render') return;

            const fnPath = findRenderFunctionPath(path.get('value'));
            if (fnPath) renameLeadingParams(fnPath, renderParamNames);
        }
    });

    // render-core vars (`var Le = function () {...}();`) are never sitting behind a literal
    // `render:` key themselves - they only become the render function once passed into their
    // factory (`Ke(Le)`) - so they need their own pass here using the same unwrapping logic.
    for (const coreOldName of renderCoreOldNames) {
        const declPath = topLevelVars.get(coreOldName);
        const init = declPath?.get('init');
        if (!init || !init.node) continue;

        const fnPath = findRenderFunctionPath(init as NodePath<t.Expression>);
        if (fnPath) renameLeadingParams(fnPath, renderParamNames);
    }

    benchmark('pass 7');

    // pass 7b: `renderList(source, (t, i) => {...})` - Vue's v-for helper (destructured off the
    // Vue global by pass 4, so its own name is never minified). The callback is always
    // positional: iterating an array/set/string/number gives `(item, idx)`; iterating a plain
    // object's entries gives `(item, key, idx)` instead - so the 3rd param is never just another
    // index-like "i", it only shows up alongside a real `key` in front of it. Either trailing
    // param may be absent if the template body never references it, so only rename however many
    // the callback actually has.
    traverse(ast, {
        CallExpression(path) {
            const { callee, arguments: args } = path.node;
            if (!t.isIdentifier(callee) || callee.name !== 'renderList') return;
            if (args.length < 2) return;

            const callbackPath = path.get('arguments')[1];
            if (!callbackPath.isFunctionExpression() && !callbackPath.isArrowFunctionExpression()) return;

            const fnPath = callbackPath as NodePath<t.Function>;
            const names = fnPath.node.params.length >= 3 ? ['item', 'key', 'idx'] : ['item', 'idx'];

            renameLeadingParams(fnPath, names);
        }
    });

    benchmark('pass 7b');

    let qrRenameCount = 0;

    const getBindingUsages = (binding: Binding): NodePath[] => [...binding.referencePaths, ...binding.constantViolations];

    const isQrRenameSafe = (binding: Binding, newName: string): boolean => {
        const scope = binding.scope;
        if (Object.hasOwn(scope.getProgramParent().globals, newName)) return false;

        const existing = scope.getBinding(newName);
        if (existing && existing.scope !== scope && getBindingUsages(existing).some(usage => usage.isDescendant(scope.path))) return false;

        return getBindingUsages(binding).every(usage => {
            for (let s: Scope | null = usage.scope; s && s !== scope; s = s.parent) if (s.hasOwnBinding(newName)) return false;
            return true;
        });
    };

    const renameQrBatch = (scope: Scope, pairs: [string, string][]) => {
        const seen = new Set<string>();
        let candidates: { binding: Binding; newName: string }[] = [];

        for (const [oldName, newName] of pairs) {
            const binding = scope.getOwnBinding(oldName);
            if (!binding || oldName === newName || seen.has(newName)) continue;
            if (!isQrRenameSafe(binding, newName)) continue;

            seen.add(newName);
            candidates.push({ binding, newName });
        }

        for (let changed = true; changed;) {
            changed = false;
            candidates = candidates.filter(candidate => {
                const own = scope.getOwnBinding(candidate.newName);
                const ok = !own || candidates.some(other => other.binding === own);
                if (!ok) changed = true;
                return ok;
            });
        }

        applyBindingRenames(candidates);
        qrRenameCount += candidates.length;
    };

    const unwrapQrFunction = (path: NodePath<t.Node | null | undefined> | undefined): NodePath<t.Function> | null => {
        if (!path || !path.node) return null;
        if (path.isFunction()) return path;
        if (!path.isCallExpression()) return null;

        const callee = path.get('callee');
        return callee.isFunction() ? callee : null;
    };

    const getBodyDeclarators = (fnPath: NodePath<t.Function>): NodePath<t.VariableDeclarator>[] => {
        const body = fnPath.get('body') as NodePath<t.Node>;
        if (!body.isBlockStatement()) return [];

        return body.get('body').flatMap(stmt => stmt.isVariableDeclaration() ? stmt.get('declarations') : []);
    };

    const getMemberFunctions = (fnPath: NodePath<t.Function>): Map<string, NodePath<t.Function>> => {
        const members = new Map<string, NodePath<t.Function>>();
        const body = fnPath.get('body') as NodePath<t.Node>;
        if (!body.isBlockStatement()) return members;

        const addObject = (objPath: NodePath<t.ObjectExpression>) => {
            for (const prop of objPath.get('properties')) {
                if (prop.isObjectMethod() && !prop.node.computed && t.isIdentifier(prop.node.key)) members.set(prop.node.key.name, prop as NodePath<t.Function>);
                else if (prop.isObjectProperty() && !prop.node.computed && t.isIdentifier(prop.node.key)) {
                    const value = prop.get('value');
                    if (value.isFunction()) members.set(prop.node.key.name, value);
                }
            }
        };

        for (const stmt of body.get('body')) {
            if (stmt.isExpressionStatement()) {
                const expr = stmt.get('expression');
                if (!expr.isAssignmentExpression({ operator: '=' })) continue;

                const { left } = expr.node;
                if (!t.isMemberExpression(left) || left.computed || !t.isIdentifier(left.property)) continue;

                const right = expr.get('right');
                if (right.isFunction()) members.set(left.property.name, right);
            } else if (stmt.isVariableDeclaration()) {
                for (const declarator of stmt.get('declarations')) {
                    const init = declarator.get('init');
                    if (init.isObjectExpression()) addObject(init);
                }
            } else if (stmt.isReturnStatement()) {
                const argument = stmt.get('argument');
                if (argument.isObjectExpression()) addObject(argument);
            }
        }

        return members;
    };

    const applyQrSpec = (fnPath: NodePath<t.Function>, spec: QrFunctionSpec) => {
        const pairs: [string, string][] = [];
        const paramNames = spec.params ?? [];

        (fnPath.get('params') as NodePath<t.Node>[]).slice(0, paramNames.length).forEach((paramPath, i) => {
            const target: NodePath<t.Node> = paramPath.isAssignmentPattern() ? paramPath.get('left') : paramPath;
            if (target.isIdentifier()) pairs.push([target.node.name, paramNames[i]]);
        });

        const declarators = getBodyDeclarators(fnPath);

        (spec.locals ?? []).forEach((name, i) => {
            const declarator = declarators[i];
            if (declarator && t.isIdentifier(declarator.node.id)) pairs.push([declarator.node.id.name, name]);
        });

        renameQrBatch(fnPath.scope, pairs);

        if (spec.methods) {
            const members = getMemberFunctions(fnPath);

            for (const [name, methodSpec] of Object.entries(spec.methods)) {
                const member = members.get(name);
                if (member) applyQrSpec(member, methodSpec);
                else console.log(`qrcode method '${name}' was not found`);
            }
        }

        for (const [name, innerSpec] of Object.entries(spec.inner ?? {})) {
            const declarator = getBodyDeclarators(fnPath).find(d => t.isIdentifier(d.node.id) && d.node.id.name === name);
            const innerFn = unwrapQrFunction(declarator?.get('init'));

            if (innerFn) applyQrSpec(innerFn, innerSpec);
            else console.log(`qrcode inner function '${name}' was not found`);
        }
    };

    const qrConfig = mappings.qrcode;

    const qrCandidates = [...topLevelVars.values()]
        .filter(declPath => !!unwrapQrFunction(declPath.get('init')))
        .map(declPath => ({ declPath, source: inputJS.slice(declPath.node.init!.start!, declPath.node.init!.end!) }));

    const qrClaimed = new Set<NodePath>();
    const qrMissing: string[] = [];
    const qrMatches: { declPath: NodePath<t.VariableDeclarator>; qrModule: (typeof qrConfig.modules)[number] }[] = [];

    for (const qrModule of qrConfig.modules) {
        const found = qrCandidates.find(candidate =>
            !qrClaimed.has(candidate.declPath) &&
            qrModule.contains.every(needle => candidate.source.includes(needle)) &&
            !(qrModule.notContains ?? []).some(needle => candidate.source.includes(needle))
        );

        if (!found) {
            qrMissing.push(qrModule.name);
            continue;
        }

        qrClaimed.add(found.declPath);
        qrMatches.push({ declPath: found.declPath, qrModule });
    }

    for (const { declPath, qrModule } of qrMatches) {
        renameQrBatch(declPath.scope, [[(declPath.node.id as t.Identifier).name, qrModule.name]]);

        const currentName = (declPath.node.id as t.Identifier).name;
        const fnPath = unwrapQrFunction(declPath.get('init'));
        if (fnPath) applyQrSpec(fnPath, qrModule);

        const block = declPath.parentPath?.parentPath;

        if (qrModule.statics && block?.isBlockStatement()) {
            for (const stmt of block.get('body')) {
                if (!stmt.isExpressionStatement()) continue;

                const expr = stmt.get('expression');
                if (!expr.isAssignmentExpression({ operator: '=' })) continue;

                const { left } = expr.node;
                if (!t.isMemberExpression(left) || left.computed || !t.isIdentifier(left.object, { name: currentName }) || !t.isIdentifier(left.property)) continue;

                const staticSpec = qrModule.statics[left.property.name];
                const right = expr.get('right');
                if (staticSpec && right.isFunction()) applyQrSpec(right, staticSpec);
            }
        }

        if (qrModule.alias) {
            const aliasDecl = [...topLevelVars.values()].find(p => t.isIdentifier(p.node.id) && t.isIdentifier(p.node.init, { name: currentName }));
            if (aliasDecl) renameQrBatch(aliasDecl.scope, [[(aliasDecl.node.id as t.Identifier).name, qrModule.alias]]);
        }
    }

    const qrErrorCorrectionLevelDecl = [...topLevelVars.values()].find(p => {
        const init = p.node.init;

        return t.isObjectExpression(init) &&
            init.properties.length === 4 &&
            init.properties.every((prop, i) => t.isObjectProperty(prop) && t.isIdentifier(prop.key, { name: 'LMQH'[i] }) && t.isNumericLiteral(prop.value, { value: [1, 0, 3, 2][i] }));
    });

    if (qrErrorCorrectionLevelDecl) {
        const { name, modeConstants, maskPatternConstants } = qrConfig.errorCorrectionLevel;
        const statement = qrErrorCorrectionLevelDecl.parentPath!;
        const pairs: [string, string][] = [[(qrErrorCorrectionLevelDecl.node.id as t.Identifier).name, name]];

        const collectConstant = (offset: number, expected: number, newName: string) => {
            const sibling = statement.getSibling((statement.key as number) + offset);
            if (!sibling.isVariableDeclaration() || sibling.node.declarations.length !== 1) return;

            const [declarator] = sibling.node.declarations;
            if (t.isIdentifier(declarator.id) && t.isNumericLiteral(declarator.init, { value: expected })) pairs.push([declarator.id.name, newName]);
        };

        modeConstants.forEach((newName, i) => collectConstant(i - modeConstants.length, 1 << i, newName));
        maskPatternConstants.forEach((newName, i) => collectConstant(i + 1, i, newName));

        renameQrBatch(qrErrorCorrectionLevelDecl.scope, pairs);
    } else qrMissing.push(qrConfig.errorCorrectionLevel.name);

    if (qrMatches.length > 0) console.log(`qrcode: renamed ${qrRenameCount} identifier(s) across ${qrMatches.length} module(s)`);
    if (qrMissing.length > 0) console.log(`qrcode: no match for ${qrMissing.join(', ')}`);

    benchmark('qrcode');

    // pass 8: fold trivial single-use hoisted consts back inline - string arrays with <= 3
    // elements (attribute-name lists like `const H = ["placeholder", "onKeyup"];`) and
    // single-key objects (vnode prop objects like `const G = { class: "nospace" };`), but only
    // when there's exactly one reference to fold into. Everything else - longer arrays,
    // multi-key objects, or more than one use site - is left as its own `const` as-is.
    type FoldCandidate = { declPath: NodePath<t.VariableDeclarator>; refPath: NodePath; valueNode: t.Expression };
    const foldCandidates: FoldCandidate[] = [];

    traverse(ast, {
        VariableDeclarator(path) {
            if (!t.isIdentifier(path.node.id)) return;

            const isForLoopVar = path.parentPath.isForStatement() || path.parentPath.isForInStatement() || path.parentPath.isForOfStatement();
            if (isForLoopVar) return;

            const init = path.node.init;
            if (!init) return;

            const isFoldableArray = t.isArrayExpression(init) &&
                init.elements.length > 0 &&
                init.elements.length <= 4 &&
                init.elements.every(el => t.isStringLiteral(el));

            const isFoldableObject = t.isObjectExpression(init) &&
                init.properties.length <= 4 &&
                t.isObjectProperty(init.properties[0]) &&
                init.properties.every(p => t.isObjectProperty(p) && mappings.whitelistedPropKeys.includes(t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : '') && (t.isStringLiteral(p.value) || t.isNumericLiteral(p.value) || ('name' in p.key && p.key.name === 'style')));

            if (!isFoldableArray && !isFoldableObject) return;

            const binding = path.scope.getBinding(path.node.id.name);
            if (!binding) return;
            if (binding.constantViolations.length > 0) return;
            if (binding.referencePaths.length !== 1) return;

            foldCandidates.push({ declPath: path, refPath: binding.referencePaths[0], valueNode: init });
        }
    });

    for (const { declPath, refPath, valueNode } of foldCandidates) {
        if (!refPath.isIdentifier()) continue; // safety - should always be true for a var binding ref

        refPath.replaceWith(t.cloneNode(valueNode, true));

        const declaration = declPath.parentPath;
        if (declaration.isVariableDeclaration() && declaration.node.declarations.length === 1) declaration.remove();
        else declPath.remove();
    }

    benchmark('pass 8');

    const output = generate(ast, { retainLines: false, compact: false }).code;
    benchmark('generate');

    return output;
}

export default buildMappedFile;
