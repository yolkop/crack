import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import generate from '@babel/generator';
import * as parser from '@babel/parser';
import traverse, { type NodePath, type Scope } from '@babel/traverse';
import * as t from '@babel/types';

import mappings from './mappings';

import { createFirstMatcher } from '../../util/matcher';

import {
    addMapping,
    checkArrayOfObjects,
    getObjectKeys,
    renameParamsByPosition,
    visitAst,
    visitAstScoped,
    walkAst,
    sortClassMembers,
    type IdentifierMapping
} from '../../util/ast';

const buildMappedFile = async (inputJS: string): Promise<string> => {
    inputJS = inputJS.replace(/\.pnpm\/@([A-Za-z]+)\+([A-Za-z]+)@[0-9]+\.[0-9]+\.[0-9]+\/node_modules\//g, '');

    const obsoleteLines = [
        'true;',
        'false;',
        'new Date();',
        '1;',
        '0;',
        'e;'
    ];

    obsoleteLines.forEach((line) => {
        const regex = new RegExp(`^\\s*${line}\\s*$`, 'gm');
        inputJS = inputJS.replace(regex, '');
    });

    const start = Date.now();
    let lastBench = Date.now();
    const benchmark = () => {
        const bench = ((Date.now() - lastBench) / 1000).toFixed(3) + 's';
        lastBench = Date.now();
        return bench;
    }

    console.log('[pre] inputJS size:', inputJS.length);

    const numCores = os.cpus().length;
    const beforeCodeMappings = mappings.functions.filter(m => 'hasCode' in m && m.hasCode && !(m as any).after) as { name: string; hasCode: string }[];
    const afterCodeMappings = mappings.functions.filter(m => 'hasCode' in m && m.hasCode && (m as any).after) as { name: string; hasCode: string }[];
    const constructorCodeMappings = mappings.classes.filter(m => 'constructorHasCode' in m) as { name: string; constructorHasCode: string }[];

    const matchBeforeCode = createFirstMatcher(beforeCodeMappings.map(m => m.hasCode));
    const matchAfterCode = createFirstMatcher(afterCodeMappings.map(m => m.hasCode));
    const matchConstructorCode = createFirstMatcher(constructorCodeMappings.map(m => m.constructorHasCode));

    const ast1Encoded = new TextEncoder().encode(inputJS);
    const ast1Buffer = new SharedArrayBuffer(ast1Encoded.byteLength);
    new Uint8Array(ast1Buffer).set(ast1Encoded);

    const ast1RegexWork = [
        ...mappings.variables.filter(m => m.regex && !m.after).map(m => ({
            kind: 'variable' as const,
            name: m.name,
            regex: m.regex!.source,
            after: false,
        })),
        ...mappings.functions.filter(m => 'regex' in m && m.regex && !(m as any).after).map(m => ({
            kind: 'function' as const,
            name: m.name,
            regex: (m as any).regex.source,
            after: false,
        })),
        ...mappings.props.filter(m => m.regex && !m.after).map(m => ({
            kind: 'prop' as const,
            name: m.name,
            regex: m.regex!.source,
            after: false,
        })),
    ];

    const ast2RegexWork = [
        ...mappings.variables.filter(m => m.regex && m.after).map(m => ({
            kind: 'variable' as const,
            name: m.name,
            regex: m.regex!.source,
            after: true,
        })),
        ...mappings.functions.filter(m => 'regex' in m && m.regex && (m as any).after).map(m => ({
            kind: 'function' as const,
            name: m.name,
            regex: (m as any).regex.source,
            after: true,
        }))
    ];

    const ast3RegexWork = [
        ...mappings.props.filter(m => m.regex && m.after).map(m => ({
            kind: 'prop' as const,
            name: m.name,
            regex: m.regex!.source,
            after: true,
        })),
    ];

    const ast1ChunkSize = Math.ceil(ast1RegexWork.length / numCores);
    const ast1Promise = Promise.all(
        Array.from({ length: numCores }, (_, i) => {
            const chunk = ast1RegexWork.slice(i * ast1ChunkSize, (i + 1) * ast1ChunkSize);
            return new Promise(resolve => {
                const w = new Worker(path.join(import.meta.dirname, 'worker.ts'), { workerData: { sab: ast1Buffer, chunk } });
                w.addListener('message', resolve);
            });
        })
    ) as Promise<{ variableRenames: Record<string, string>, functionRenames: Record<string, string>, propertyRenames: Record<string, string> }[]>;

    const ast = parser.parse(inputJS, { sourceType: 'module' });

    console.log('[ast1] parsed in', benchmark());

    const variableRenames: Record<string, string> = {};
    const functionRenames: Record<string, string> = {};
    const propertyRenames: Record<string, string> = {};

    let commCodeVarName: string | null = null;

    const commRegex = mappings.variables.find(e => e.name === 'CommCode' && e.regex)!;
    const commRegexCompiled = new RegExp(commRegex.regex, 'g');
    const commMatch = commRegexCompiled.exec(inputJS);
    commCodeVarName = commMatch?.[1] ?? null;

    if (commCodeVarName) {
        const commCodePropertyMap: { [key: string]: string } = {};

        visitAst(ast, {
            VariableDeclarator(path) {
                if (!t.isIdentifier(path.node.id)) return;
                if (path.node.id.name !== commCodeVarName) return;
                if (!path.node.init || !t.isObjectExpression(path.node.init)) return;

                for (const prop of path.node.init.properties) {
                    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                        const obfuscatedKey = prop.key.name;

                        let done = false;

                        for (const [readableName, obfuscatedValue] of Object.entries(mappings.commCodes)) {
                            if (obfuscatedValue === obfuscatedKey) {
                                commCodePropertyMap[obfuscatedKey] = readableName;
                                prop.key.name = readableName;
                                done = true;
                                break;
                            }
                        }

                        if (!done) prop.key.name = `code${(prop.value as t.NumericLiteral).value}`;
                    }
                }
            },
            MemberExpression(path) {
                if (!t.isIdentifier(path.node.object)) return;
                if (path.node.object.name !== commCodeVarName) return;
                if (path.node.computed) return;
                if (!t.isIdentifier(path.node.property)) return;

                const obfuscatedProp = path.node.property.name;
                const readableProp = commCodePropertyMap[obfuscatedProp];

                if (readableProp) path.node.property.name = readableProp;
            }
        });
    } else console.warn('failed to find CommCode variable name');

    console.log('[ast1] remapped CommCode in', benchmark());

    traverse(ast, { Program(path) { path.stop(); } });

    visitAstScoped(ast, {
        VariableDeclarator(path) {
            if (!t.isIdentifier(path.node.id)) return;

            const varName = path.node.id.name;
            const init = path.node.init;

            if (!init) return;

            // var X = class y {}
            if (t.isClassExpression(init)) {
                const classProps: string[] = [];

                for (const item of init.body.body) {
                    if (t.isClassMethod(item) && t.isIdentifier(item.key)) classProps.push(item.key.name);
                    else if (t.isClassProperty(item) && t.isIdentifier(item.key)) classProps.push(item.key.name);
                }

                for (const mapping of mappings.classes) {
                    if ('hasProps' in mapping) {
                        const hasAll = mapping.hasProps.every(prop => classProps.includes(prop));
                        if (hasAll) variableRenames[varName] = mapping.name;
                    }
                }

                // [babylon] if class has getClassName method that returns a string
                const getClassNameMethod = init.body.body.find(
                    item => t.isClassMethod(item) &&
                        t.isIdentifier(item.key) &&
                        item.key.name === 'getClassName'
                ) as t.ClassMethod | undefined;

                if (getClassNameMethod) {
                    try {
                        let returnedName: string | null = null;

                        walkAst(getClassNameMethod, node => {
                            if (returnedName === null && t.isReturnStatement(node) && t.isStringLiteral(node.argument)) returnedName = node.argument.value;
                        });

                        if (returnedName) {
                            variableRenames[varName] = `BABYLON_${returnedName}`;
                            return;
                        }
                    } catch (e) {
                        console.warn(`Failed to extract getClassName for ${varName}:`, e);
                    }
                }

                const constructor = init.body.body.find(
                    item => t.isClassMethod(item) && item.kind === 'constructor'
                ) as t.ClassMethod | undefined;

                if (constructor) {
                    const constructorCode = generate(constructor, { compact: false }).code;

                    const matchedIdx = matchConstructorCode(constructorCode);
                    if (matchedIdx !== -1) {
                        variableRenames[varName] = constructorCodeMappings[matchedIdx].name;
                        return;
                    }

                    if (constructor.body) {
                        for (const stmt of constructor.body.body) {
                            if (t.isExpressionStatement(stmt) &&
                                t.isAssignmentExpression(stmt.expression) &&
                                t.isMemberExpression(stmt.expression.left) &&
                                t.isThisExpression(stmt.expression.left.object) &&
                                t.isIdentifier(stmt.expression.left.property) &&
                                stmt.expression.left.property.name === 'name' &&
                                t.isIdentifier(stmt.expression.right)) {

                                const nameVarName = stmt.expression.right.name;
                                const binding = path.scope?.getBinding(nameVarName);

                                if (binding && t.isVariableDeclarator(binding.path.node)) {
                                    const init = binding.path.node.init;

                                    if (t.isStringLiteral(init)) {
                                        const extensionName = init.value;
                                        variableRenames[varName] = `BABYLON_LoaderExt_${extensionName}`;
                                        variableRenames[nameVarName] = `BABYLON_LoaderExtName_${extensionName}`;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) {
                const funcCode = generate(init, { compact: false }).code;

                const matchedIdx = matchBeforeCode(funcCode);
                if (matchedIdx !== -1) {
                    variableRenames[varName] = beforeCodeMappings[matchedIdx].name;
                    return;
                }
            }
        },
        AssignmentExpression(path) {
            try {
                if (t.isMemberExpression(path.node.left) &&
                    t.isIdentifier(path.node.left.object) &&
                    t.isIdentifier(path.node.left.property) &&
                    (
                        path.node.left.property.name === 'CLASSNAME' ||
                        path.node.left.property.name === 'ClassName'
                    ) &&
                    t.isStringLiteral(path.node.right)) {

                    variableRenames[path.node.left.object.name] = `BABYLON_${path.node.right.value}`;
                }
            } catch { }
        },
        FunctionDeclaration(path) {
            if (!t.isIdentifier(path.node.id)) return;

            const funcName = path.node.id.name;

            try {
                const funcCode = generate(path.node, { compact: false }).code;

                const matchedIdx = matchBeforeCode(funcCode);
                if (matchedIdx !== -1) {
                    functionRenames[funcName] = beforeCodeMappings[matchedIdx].name;
                    return;
                }
            } catch (e) {
                console.warn(`failed to process function ${funcName}:`, e);
            }
        }
    });

    console.log('[ast1] crawled auto babylon & hasCodes in', benchmark());

    const remapObjectOrArray = (path: NodePath<t.VariableDeclarator>) => {
        if (!t.isIdentifier(path.node.id)) return;

        const varName = path.node.id.name;
        const init = path.node.init;

        if (!init) return;

        if (t.isObjectExpression(init)) {
            const keys = getObjectKeys(init);

            for (const mapping of mappings.objects) {
                if (mapping.hasKeys && mapping.hasKeys.every(key => keys.includes(key))) {
                    if (mapping.keyCount && keys.length !== mapping.keyCount) continue;

                    variableRenames[varName] = mapping.name;

                    if (mapping.inline) {
                        const inlineMap: Record<string, t.StringLiteral | t.NumericLiteral> = {};

                        for (const prop of init.properties) {
                            if (
                                t.isObjectProperty(prop) &&
                                t.isIdentifier(prop.key) &&
                                !prop.computed &&
                                (t.isStringLiteral(prop.value) || t.isNumericLiteral(prop.value))
                            ) {
                                inlineMap[prop.key.name] = prop.value;
                            }
                        }

                        const binding = path.scope.getBinding(varName);
                        if (binding) {
                            let replacedCount = 0;

                            for (const ref of binding.referencePaths) {
                                const refParent = ref.parentPath;
                                if (!refParent) continue;

                                if (refParent.isMemberExpression({ object: ref.node }) && !refParent.node.computed && t.isIdentifier(refParent.node.property)) {
                                    const key = refParent.node.property.name;
                                    if (key in inlineMap) {
                                        refParent.replaceWith(t.cloneNode(inlineMap[key]));
                                        replacedCount++;
                                    }
                                } else if (refParent.isMemberExpression({ object: ref.node }) && refParent.node.computed && t.isStringLiteral(refParent.node.property)) {
                                    const key = refParent.node.property.value;
                                    if (key in inlineMap) {
                                        refParent.replaceWith(t.cloneNode(inlineMap[key]));
                                        replacedCount++;
                                    }
                                }
                            }

                            if (replacedCount === binding.referencePaths.length) {
                                delete variableRenames[varName];
                                path.remove();
                            }
                        }
                    }
                }
            }
        }

        if (t.isArrayExpression(init)) {
            for (const mapping of mappings.constants) {
                if (mapping.objectHasProps && checkArrayOfObjects(init, mapping.objectHasProps))
                    variableRenames[varName] = mapping.name;
            }
        }
    };

    const collectObjectPaths = (): NodePath<t.VariableDeclarator>[] | null => {
        const pathCache = (traverse as any).cache.path as WeakMap<t.Node, Map<t.Node, NodePath>>;
        const found: NodePath<t.VariableDeclarator>[] = [];
        let complete = true;

        walkAst(ast, (node, parent) => {
            if (!t.isVariableDeclarator(node) || !t.isIdentifier(node.id) || !node.init) return;
            if (!t.isObjectExpression(node.init) && !t.isArrayExpression(node.init)) return;

            const cachedPath = parent ? pathCache.get(parent)?.get(node) : undefined;
            if (cachedPath && cachedPath.node === node) found.push(cachedPath as NodePath<t.VariableDeclarator>);
            else complete = false;
        });

        return complete ? found : null;
    };

    const objectPaths = collectObjectPaths();

    if (objectPaths) {
        for (const objectPath of objectPaths) {
            let detached = false;
            for (let ancestor: NodePath<t.Node> | null = objectPath.parentPath; ancestor; ancestor = ancestor.parentPath)
                if (ancestor.removed || !ancestor.node) detached = true;
            if (!detached) remapObjectOrArray(objectPath);
        }
    } else traverse(ast, { VariableDeclarator(path) { remapObjectOrArray(path); } });

    console.log('[ast1] remapped objects/arrays in', benchmark());

    const ast1Results = await ast1Promise;

    for (const result of ast1Results) {
        Object.assign(variableRenames, result.variableRenames);
        Object.assign(functionRenames, result.functionRenames);
        Object.assign(propertyRenames, result.propertyRenames);
    }

    console.log('[ast1] got regex results in', benchmark());

    visitAst(ast, {
        Identifier(path) {
            const oldName = path.node.name;
            const newName = variableRenames[oldName] || functionRenames[oldName];
            if (!newName || typeof newName !== 'string') return;

            const parent = path.parent;

            if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) return;
            if (t.isClassMethod(parent) && parent.key === path.node && !parent.computed) return;
            if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
            if (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed) return;
            if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === path.node && !parent.computed) return;

            path.node.name = newName;
        }
    });

    console.log('[ast1] remapped all befores in', benchmark());

    inputJS = generate(ast, { retainLines: false, compact: false }).code;
    console.log('[ast1] generated final code in', benchmark());

    const ast2Encoded = new TextEncoder().encode(inputJS);
    const ast2Buffer = new SharedArrayBuffer(ast2Encoded.byteLength);
    new Uint8Array(ast2Buffer).set(ast2Encoded);

    const babylonScanPromise = new Promise<{
        createShader?: string;
        ensureShaderStore?: string;
        shaderAccessor: string[][];
        shaderFactory: string[][];
        shaderInclude: string[][];
        wgslStub: string[][];
    }>(resolve => {
        const w = new Worker(path.join(import.meta.dirname, 'babylonWorker.ts'), { workerData: { sab: ast2Buffer } });
        w.addListener('message', resolve);
    });

    const ast2ChunkSize = Math.ceil(ast2RegexWork.length / numCores);
    const ast2Promise = Promise.all(
        Array.from({ length: numCores }, (_, i) => {
            const chunk = ast2RegexWork.slice(i * ast2ChunkSize, (i + 1) * ast2ChunkSize);
            return new Promise(resolve => {
                const w = new Worker(path.join(import.meta.dirname, 'worker.ts'), { workerData: { sab: ast2Buffer, chunk } });
                w.addListener('message', resolve);
            });
        })
    ) as Promise<{ variableRenames: Record<string, string>, functionRenames: Record<string, string>, propertyRenames: Record<string, string> }[]>;

    const ast2 = ast;
    traverse.cache.clear();

    traverse(ast2, { Program(path) { path.stop(); } });
    console.log('[ast2] starting w/ 0 syntax errors');

    const babylonMap: IdentifierMapping = {};

    // fixing babylon shader names and factories

    /*
    var Qt = {};
    $VAR9(Qt, {
    shadowMapFragment: () => Jt
    */

    // { name: 'BABYLON_assignToObject', regex: /([A-z0-9$_]+)\([A-z], \{\s*bonesDeclarationWGSL:/ },

    const babylonScan = await babylonScanPromise;
    const shaderAccessorMatches = babylonScan.shaderAccessor;

    for (const match of shaderAccessorMatches) {
        if (match[1] && match[2] && match[3] && match[4] && match[1] === match[2]) {
            // match[1] = the assigned object
            // match[3] = the public property name
            // match[4] = the internal property name
            if (match[1].length === 2) addMapping(babylonMap, match[1], `BABYLON_ShaderPublic_${match[3]}`);
            if (match[4].length === 2) addMapping(babylonMap, match[4], `BABYLON_ShaderInternal_${match[3]}`);
        }
    }

    /*
    var Yt = createShader({
    "../node_modules/@babylonjs/core/Shaders/ShadersInclude/shadowMapVertexMetric.js"() {
      BABYLON_ensureShaderStore();
      Bt = "shadowMapVertexMetric";
      */

    // { name: 'createShader', regex: /([A-z0-9$_]+)\(\{\s*"..\/node_modules\/@babylonjs\/core\/Shaders\/ShadersInclude/ }
    const createShader = babylonScan.createShader;
    if (!createShader) console.error('failed to find createShader function name');

    // { name: 'BABYLON_ensureShaderStore', regex: /postprocess.vertex.js"\(\) \{\s*([A-z0-9$_]+)\(\);/ },
    const ensureShaderStore = babylonScan.ensureShaderStore;
    if (!ensureShaderStore) console.error('failed to find BABYLON_ensureShaderStore function name');

    const shaderFactoryMatches = babylonScan.shaderFactory;

    for (const match of shaderFactoryMatches) {
        if (match[1] && match[2] && match[3] && match[4]) {
            // match[1] = the shader factory
            // match[2] = the variable assigned the shader name
            // match[3] = the shader name
            // match[4] = the variable assigned the shader content
            if (match[2].length === 2) addMapping(babylonMap, match[2], `BABYLON_ShaderName_${match[3]}`);
            if (match[1].length === 2) addMapping(babylonMap, match[1], `BABYLON_ShaderFactory_${match[3]}`);
            if (match[4].length === 2) addMapping(babylonMap, match[4], `BABYLON_ShaderCode_${match[3]}`);
        }
    }

    /*
    var ql = createShader({
    "../node_modules/@babylonjs/core/Shaders/ShadersInclude/pbrBlockImageProcessing.js"() {
      BABYLON_ensureShaderStore();
      e.IncludesShadersStore.pbrBlockImageProcessing = "
    
      - OR -
    
      var gi = createShader({
    "../node_modules/@babylonjs/core/ShadersWGSL/ShadersInclude/kernelBlurVaryingDeclaration.js"() {
      BABYLON_ensureShaderStore();
      e.IncludesShadersStoreWGSL.kernelBlurVaryingDeclaration = "
      */
    const shaderIncludeMatches = babylonScan.shaderInclude;

    for (const match of shaderIncludeMatches) {
        if (match[1] && match[2]) {
            // match[1] = the shader include factory
            // match[2] = the shader name
            if (match[1].length === 2) addMapping(babylonMap, match[1], `BABYLON_ShaderIncludeFactory_${match[2]}`);
        }
    }

    /*
      var Ii = o({
    "wgsl-stub:../ShadersWGSL/default.fragment.js"() {}
  });
  */

    const wgslStubMatches = babylonScan.wgslStub;

    for (const match of wgslStubMatches) {
        if (match[2]) {
            // match[1] = the stub store
            // match[2] = the minified name
            // match[3] = the shader name
            if (match[3]) {
                if (match[1].length === 2) addMapping(babylonMap, match[1], `BABYLON_WGSLStubFactoryObject_${match[3].replaceAll(/[^a-zA-Z]/g, '_')}`);
                if (match[2].length === 2) addMapping(babylonMap, match[2], `BABYLON_WGSLStubFactory_${match[3].replaceAll(/[^a-zA-Z]/g, '_')}`);
            }
        }
    }

    console.log('[ast2] identified babylon shaders in', benchmark());

    let switchForDepth = 0;

    walkAst(ast2, (node, parent) => {
        if (t.isSwitchStatement(node) || t.isForStatement(node)) switchForDepth++;
        if (!t.isIdentifier(node)) return;

        const oldName = node.name;
        if (!Object.hasOwn(babylonMap, oldName)) return;

        const newName = babylonMap[oldName];
        if (!newName || typeof newName !== 'string') return console.warn(`skipping invalid mapping for ${oldName}: ${newName}`);

        if (t.isObjectProperty(parent) && parent.key === node && !parent.computed) return;
        if (t.isClassMethod(parent) && parent.key === node && !parent.computed) return;
        if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
        if (t.isObjectMethod(parent) && parent.key === node && !parent.computed) return;
        if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === node && !parent.computed) return;

        if (switchForDepth === 0) node.name = newName;
    }, node => {
        if (t.isSwitchStatement(node) || t.isForStatement(node)) switchForDepth--;
    });

    console.log('[ast2] mapped babylon shaders in', benchmark());

    const ast2Results = await ast2Promise;

    const ast2Map: IdentifierMapping = {};
    for (const result of ast2Results) {
        Object.assign(ast2Map, result.variableRenames);
        Object.assign(ast2Map, result.functionRenames);
    }

    console.log('[ast2] identified variable mappings in', benchmark());

    visitAst(ast2, {
        FunctionDeclaration(path) {
            if (!t.isIdentifier(path.node.id)) return;

            const funcName = path.node.id.name;

            try {
                const funcCode = generate(path.node, { compact: false }).code;

                const matchedIdx = matchAfterCode(funcCode);
                if (matchedIdx !== -1) return addMapping(ast2Map, funcName, afterCodeMappings[matchedIdx].name);
            } catch (e) {
                console.warn(`Failed to process function ${funcName}:`, e);
            }
        }
    });

    console.log('[ast2] identified function mappings (pass 2) in', benchmark());

    visitAst(ast2, {
        Identifier(path) {
            const oldName = path.node.name;
            if (!Object.hasOwn(ast2Map, oldName)) return;

            const newName = ast2Map[oldName];
            if (!newName || typeof newName !== 'string') return console.warn(`skipping invalid mapping for ${oldName}: ${newName}`);

            const parent = path.parent;

            if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) return;
            if (t.isClassMethod(parent) && parent.key === path.node && !parent.computed) return;
            if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
            if (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed) return;
            if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === path.node && !parent.computed) return;

            path.node.name = newName;
        }
    });

    console.log('[ast2] remapped after functions & variables in', benchmark());

    // separate map for $VAR1, $VAR2, ..., $VAR20
    const parameterRenames: IdentifierMapping = {};

    let regexString = 'function BABYLON_ExtrudeShapeGeneric\\(';
    const paramCount = 20;
    const paramNames: string[] = [];

    // invertToRef(t) {
    const cursedMap = {
        0: 'e',
        1: 't',
        2: 'i',
        3: 'n',
        4: 'a',
        5: 's',
        6: 'r',
        7: 'o',
        8: 'l',
        9: 'c',
        10: 'h',
        11: 'f',
        12: 'u',
        13: 'm',
        14: 'd',
        15: 'p',
        16: '_',
        17: 'v',
        18: 'g',
        19: 'y'
    }

    for (let i = 0; i < paramCount; i++) {
        paramNames.push(`param${i + 1}`);
        regexString += '([a-z_])';
        if (i < paramCount - 1) regexString += ', ';
    }
    regexString += '\\)';

    const cursedRegex = new RegExp(regexString);
    const cursedMatcher = cursedRegex.exec(inputJS);

    if (cursedMatcher) {
        const matchedVars = cursedMatcher.slice(1, paramCount + 1);

        if (matchedVars.length === paramCount && matchedVars.every(v => v)) {
            matchedVars.forEach((varName, index) => {
                const cursedMapItem = (cursedMap as any)[index];
                if (varName !== cursedMapItem) parameterRenames[varName] = cursedMapItem;
            });
        } else console.warn('failed to capture the 20 parameters');
    }

    const invertToRefContents = inputJS.match(/invertToRef\(\w+\)\s*\{([\s\S]+?)\n\s*\}\n\s*(?:isIdentity|static)/);
    const constantNames = invertToRefContents ? Array.from(invertToRefContents[1].matchAll(/const\s+([a-zA-Z0-9$_]+)\s*=/g)).map(m => m[1]) : [];

    const accurateNames = {
        // content from cursedMatcher ends at idx 17
        18: 'S',
        19: 'E',
        20: 'A',
        21: 'C',
        22: 'R',
        23: 'T',
        24: 'N',
        25: 'M',
        26: 'I',
        27: 'x',
        28: 'b',
        29: 'P',
        30: 'w',
        31: 'O',
        32: 'D',
        33: 'L',
        34: 'F',
        35: 'k',
        36: 'B',
        37: 'G',
        38: 'U',
        39: 'H',
        40: 'V',
        41: 'W',
        42: 'z',
        43: 'X',
        44: 'Y',
        45: 'j',
        46: 'K',
        47: '$',
        48: 'q',
        49: 'J',
        50: 'Q',
        51: 'Z'
    }

    const accurateNamesArray = Object.entries(accurateNames)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([_, value]) => value);

    for (let i = 0; i < 18; i++) accurateNamesArray.unshift('');

    constantNames.forEach((constName, index) => {
        if (parameterRenames[constName]) return;
        const accurateName = accurateNamesArray[index];
        if (accurateName && constName !== accurateName) parameterRenames[constName] = accurateName;
    });

    visitAst(ast2, {
        ClassDeclaration(path) {
            for (const item of path.node.body.body) {
                if (t.isClassMethod(item) && t.isIdentifier(item.key)) {
                    const newName = propertyRenames[item.key.name];
                    if (newName) item.key.name = newName;
                } else if (t.isClassProperty(item) && t.isIdentifier(item.key)) {
                    const oldName = item.key.name;
                    const newName = propertyRenames[oldName];
                    if (newName && typeof newName === 'string') item.key.name = newName;
                }
            }
        },
        ClassExpression(path) {
            for (const item of path.node.body.body) {
                if (t.isClassMethod(item) && t.isIdentifier(item.key)) {
                    const oldName = item.key.name;
                    const newName = propertyRenames[oldName];
                    if (newName && typeof newName === 'string') item.key.name = newName;
                } else if (t.isClassProperty(item) && t.isIdentifier(item.key)) {
                    const oldName = item.key.name;
                    const newName = propertyRenames[oldName];
                    if (newName && typeof newName === 'string') item.key.name = newName;
                }
            }
        },
        ObjectExpression(path) {
            for (const prop of path.node.properties) {
                if (t.isObjectProperty(prop)) {
                    if (t.isIdentifier(prop.key) && !prop.computed) {
                        const oldKeyName = prop.key.name;
                        const newKeyName = propertyRenames[oldKeyName];

                        if (newKeyName && typeof newKeyName === 'string') {
                            prop.key.name = newKeyName;
                            if (prop.shorthand) prop.shorthand = false;
                        }
                    }
                }
            }
        },
        VariableDeclarator(path) {
            const isForLoopVar = t.isForStatement(path.parent) || t.isForInStatement(path.parent) || t.isForOfStatement(path.parent);

            if (isForLoopVar && t.isIdentifier(path.node.id)) {
                const oldName = path.node.id.name;
                const newName = parameterRenames[oldName];

                if (newName && typeof newName === 'string') path.node.id.name = newName;
                return;
            }

            if (t.isObjectPattern(path.node.id)) {
                for (const prop of path.node.id.properties) {
                    if (t.isObjectProperty(prop)) {
                        if (t.isIdentifier(prop.key) && !prop.computed) {
                            const oldKeyName = prop.key.name;
                            const newKeyName = propertyRenames[oldKeyName];

                            if (newKeyName && typeof newKeyName === 'string') {
                                prop.key.name = newKeyName;
                                if (prop.shorthand) prop.shorthand = false;
                            }
                        }

                        const valueNode = prop.value;
                        let oldName: string | null = null;

                        if (t.isIdentifier(valueNode)) oldName = valueNode.name;
                        else if (t.isAssignmentPattern(valueNode) && t.isIdentifier(valueNode.left)) oldName = valueNode.left.name;

                        if (oldName) {
                            const newName = propertyRenames[oldName];
                            if (newName && typeof newName === 'string') {
                                if (t.isIdentifier(valueNode)) valueNode.name = newName;
                                else if (t.isAssignmentPattern(valueNode) && t.isIdentifier(valueNode.left)) valueNode.left.name = newName;
                            }
                        }
                    }
                }
            }
        },
        MemberExpression(path) {
            if (path.node.computed) return;
            if (!t.isIdentifier(path.node.property)) return;

            if (t.isIdentifier(path.node.object) && path.node.object.name === 'window') return;

            const oldName = path.node.property.name;
            const newName = propertyRenames[oldName];

            if (oldName === 'on' && path.parent && t.isCallExpression(path.parent) && path.parent.callee === path.node) return;

            if (newName && typeof newName === 'string') path.node.property.name = newName;
        },
        OptionalMemberExpression(path) {
            if (path.node.computed) return;
            if (!t.isIdentifier(path.node.property)) return;

            const oldName = path.node.property.name;
            const newName = propertyRenames[oldName];

            if (newName && typeof newName === 'string') path.node.property.name = newName;
        },
        Identifier(path) {
            const oldName = path.node.name;
            const newName = parameterRenames[oldName];
            if (!newName || typeof newName !== 'string') return;

            const parent = path.parent;

            if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) return;
            if (t.isClassMethod(parent) && parent.key === path.node && !parent.computed) return;
            if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
            if (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed) return;
            if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === path.node && !parent.computed) return;

            path.node.name = newName;
        }
    });

    console.log('[ast2] renamed babylon & properties in', benchmark());

    inputJS = generate(ast2, { retainLines: false, compact: false }).code;
    console.log('[ast2] generated final code in', benchmark());

    // this has been working?? :sob:
    // still need to generate inputJS for after regexes
    const ast3 = ast2;

    console.log('[ast3] starting w/ 0 syntax errors');

    const ast3Encoded = new TextEncoder().encode(inputJS);
    const ast3Buffer = new SharedArrayBuffer(ast3Encoded.byteLength);
    new Uint8Array(ast3Buffer).set(ast3Encoded);

    const ast3ChunkSize = Math.ceil(ast3RegexWork.length / numCores);
    const ast3Promise = Promise.all(
        Array.from({ length: numCores }, (_, i) => {
            const chunk = ast3RegexWork.slice(i * ast3ChunkSize, (i + 1) * ast3ChunkSize);
            return new Promise(resolve => {
                const w = new Worker(path.join(import.meta.dirname, 'worker.ts'), { workerData: { sab: ast3Buffer, chunk } });
                w.addListener('message', resolve);
            });
        })
    ) as Promise<{ propertyRenames: Record<string, string> }[]>;

    const switchRegexes = mappings.commSwitch.filter(m => m.regex).map(m => ({
        name: m.name,
        regex: new RegExp(m.regex!, 'g')
    }));

    const forStack: t.ForStatement[] = [];

    walkAst(ast3, node => {
        if (t.isForStatement(node)) forStack.push(node);
        if (!t.isSwitchStatement(node)) return;

        const forLoopParent = forStack[forStack.length - 1];
        if (!forLoopParent || !forLoopParent.test) return;

        const string = generate(forLoopParent.test).code;
        if (!string.includes('isMoreDataAvailable')) return;

        const fullForLoopCode = generate(forLoopParent).code;

        const switchRenames: IdentifierMapping = {};

        for (const { name, regex } of switchRegexes) {
            regex.lastIndex = 0;

            const match = regex.exec(fullForLoopCode);
            if (match && match[1]) {
                switchRenames[match[1]] = name;
                // console.log(`CommSwitch mapping: ${match[1]} -> ${name}`);
            }
        }

        walkAst(node, (identifier, parent) => {
            if (!t.isIdentifier(identifier)) return;

            const oldName = identifier.name;
            const newName = switchRenames[oldName];
            if (!newName) return;

            // skip object direct prop keys
            if (t.isObjectProperty(parent) && parent.key === identifier && !parent.computed) return;
            // skip class method names
            if (t.isClassMethod(parent) && parent.key === identifier && !parent.computed) return;
            // skip import/export (shouldn't be in shell but anyway)
            if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
            // skip object method names
            if (t.isObjectMethod(parent) && parent.key === identifier && !parent.computed) return;
            // skip non-computed member expression properties
            if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === identifier && !parent.computed) return;

            identifier.name = newName;
            // console.log(`remapped CommSwitch identifier: ${oldName} -> ${newName}`);
        });
    }, node => {
        if (t.isForStatement(node)) forStack.pop();
    });

    console.log('[ast3] processed comm switch mappings in', benchmark());

    const afterPropertyRenames: IdentifierMapping = {};
    const ast3Result = await ast3Promise;
    Object.assign(afterPropertyRenames, ...ast3Result.map(r => r.propertyRenames));

    console.log('[ast3] identified property renames in', benchmark());

    visitAst(ast3, {
        ClassDeclaration(path) {
            for (const item of path.node.body.body) {
                if (t.isClassMethod(item) && t.isIdentifier(item.key)) {
                    const oldName = item.key.name;
                    const newName = afterPropertyRenames[oldName];
                    if (newName && typeof newName === 'string') item.key.name = newName;
                } else if (t.isClassProperty(item) && t.isIdentifier(item.key)) {
                    const oldName = item.key.name;
                    const newName = afterPropertyRenames[oldName];
                    if (newName && typeof newName === 'string') item.key.name = newName;
                }
            }
        },
        ClassExpression(path) {
            for (const item of path.node.body.body) {
                if (t.isClassMethod(item) && t.isIdentifier(item.key)) {
                    const oldName = item.key.name;
                    const newName = afterPropertyRenames[oldName];
                    if (newName && typeof newName === 'string') item.key.name = newName;
                } else if (t.isClassProperty(item) && t.isIdentifier(item.key)) {
                    const oldName = item.key.name;
                    const newName = afterPropertyRenames[oldName];
                    if (newName && typeof newName === 'string') item.key.name = newName;
                }
            }
        },
        ObjectExpression(path) {
            for (const prop of path.node.properties) {
                if (t.isObjectProperty(prop)) {
                    if (t.isIdentifier(prop.key) && !prop.computed) {
                        const oldKeyName = prop.key.name;
                        const newKeyName = afterPropertyRenames[oldKeyName];

                        if (newKeyName && typeof newKeyName === 'string') {
                            prop.key.name = newKeyName;
                            if (prop.shorthand) prop.shorthand = false;
                        }
                    }
                }
            }
        },
        VariableDeclarator(path) {
            if (t.isObjectPattern(path.node.id)) {
                for (const prop of path.node.id.properties) {
                    if (t.isObjectProperty(prop)) {
                        if (t.isIdentifier(prop.key) && !prop.computed) {
                            const oldKeyName = prop.key.name;
                            const newKeyName = afterPropertyRenames[oldKeyName];

                            if (newKeyName && typeof newKeyName === 'string') {
                                prop.key.name = newKeyName;
                                if (prop.shorthand) prop.shorthand = false;
                            }
                        }

                        const valueNode = prop.value;
                        let oldName: string | null = null;

                        if (t.isIdentifier(valueNode)) {
                            oldName = valueNode.name;
                        } else if (t.isAssignmentPattern(valueNode) && t.isIdentifier(valueNode.left)) {
                            oldName = valueNode.left.name;
                        }

                        if (oldName) {
                            const newName = afterPropertyRenames[oldName];
                            if (newName && typeof newName === 'string') {
                                if (t.isIdentifier(valueNode)) {
                                    valueNode.name = newName;
                                } else if (t.isAssignmentPattern(valueNode) && t.isIdentifier(valueNode.left)) {
                                    valueNode.left.name = newName;
                                }
                            }
                        }
                    }
                }
            }
        },
        MemberExpression(path) {
            if (path.node.computed) return;
            if (!t.isIdentifier(path.node.property)) return;

            if (t.isIdentifier(path.node.object) && path.node.object.name === 'window') return;

            const oldName = path.node.property.name;
            const newName = afterPropertyRenames[oldName];

            if (newName && typeof newName === 'string') path.node.property.name = newName;
        }
    });

    console.log('[ast3] remapped after property renames in', benchmark());

    traverse(ast3, {
        ClassExpression(path) {
            sortClassMembers(path.node.body);
        },
        ClassDeclaration(path) {
            sortClassMembers(path.node.body);
        },
        VariableDeclarator(path) {
            if (path.node.init && t.isClassExpression(path.node.init))
                sortClassMembers(path.node.init.body);
        },
        ExpressionStatement(path) {
            // remove orphaned strings
            if (t.isStringLiteral(path.node.expression)) path.remove();

            // remove standalone expressions (like `BABYLON__unusedVar_229450;`)
            if (path.node?.expression && t.isIdentifier(path.node.expression)) path.remove();
        },
        VariableDeclaration(path) {
            const constantsToRemove = new Map<string, t.Expression>();

            const isForLoopInit = path.parentPath.isForStatement() ||
                path.parentPath.isForInStatement() ||
                path.parentPath.isForOfStatement();
            if (isForLoopInit) return;

            path.node.declarations.forEach(decl => {
                if (!t.isIdentifier(decl.id)) return;

                const binding = path.scope.getBinding(decl.id.name);
                if (!binding) return;

                const isReassigned = binding.constantViolations.length > 0 ||
                    binding.referencePaths.some(ref => {
                        const p = ref.parentPath;
                        return p && (
                            (t.isAssignmentExpression(p.node) && p.node.left === ref.node) ||
                            (t.isUpdateExpression(p.node) && p.node.argument === ref.node)
                        );
                    });

                if (isReassigned) return;
                if (!binding.constant) return;

                const init = decl.init;

                if (t.isNumericLiteral(init)) {
                    const actualRefs = binding.referencePaths.filter(ref => {
                        if (ref === binding.path.get('id') || !('name' in decl.id)) return false;
                        const refBinding = ref.scope.getBinding(decl.id.name);
                        return refBinding === binding;
                    });

                    const usedAsCallee = actualRefs.some(ref => (t.isCallExpression(ref.parent) || t.isOptionalCallExpression(ref.parent)) && ref.parent.callee === ref.node);
                    if (usedAsCallee) return;

                    const usedAsMemberObject = actualRefs.some(ref => (t.isMemberExpression(ref.parent) || t.isOptionalMemberExpression(ref.parent)) && ref.parent.object === ref.node);
                    if (usedAsMemberObject) return;

                    const canInline = actualRefs.every(ref => {
                        const parent = ref.parent;
                        if (t.isBinaryExpression(parent) && parent.operator === '|' &&
                            t.isNumericLiteral(parent.right) && parent.right.value === 0) {
                            return false;
                        }
                        return true;
                    });

                    if (canInline && actualRefs.length > 0 && actualRefs.length <= 3)
                        constantsToRemove.set(decl.id.name, init);
                }
            });

            for (const [varName, value] of constantsToRemove) {
                const binding = path.scope.getBinding(varName);
                if (!binding) continue;

                const safeRefs = binding.referencePaths.filter(ref => {
                    if (ref === binding.path.get('id')) return false;
                    if (!('id' in binding.path.node) || !binding.path.node.id || !('name' in binding.path.node.id)) return false;
                    const refBinding = ref.scope.getBinding(varName);
                    return refBinding === binding;
                });

                safeRefs.forEach(refPath => {
                    if (refPath === binding.path.get('id')) return;
                    if (path.node.kind === 'let' || path.node.kind === 'const') return;

                    if (t.isNullLiteral(value)) refPath.replaceWith(t.nullLiteral());
                    else if (t.isBooleanLiteral(value)) refPath.replaceWith(t.booleanLiteral(value.value));
                    else if (t.isNumericLiteral(value)) refPath.replaceWith(t.numericLiteral(value.value));
                });
            }

            path.node.declarations = path.node.declarations.filter(decl => {
                if (!t.isIdentifier(decl.id)) return true;

                const varName = decl.id.name;
                return !constantsToRemove.has(varName);
            });

            // rm the entire block if it has no declarations left
            if (path.node.declarations.length === 0) path.remove();
        },
        IfStatement(path) {
            const test = path.get('test');

            if (test.isBooleanLiteral()) {
                if (!test.node.value) {
                    if (path.node.alternate) path.replaceWith(path.node.alternate);
                    else path.remove();
                } else path.replaceWith(path.node.consequent);

                return;
            }

            if (test.isIdentifier()) {
                const binding = path.scope.getBinding(test.node.name);
                if (binding && binding.constant && t.isVariableDeclarator(binding.path.node)) {
                    const init = binding.path.node.init;
                    if (t.isBooleanLiteral(init)) {
                        if (!init.value) {
                            if (path.node.alternate) path.replaceWith(path.node.alternate);
                            else path.remove();
                        } else path.replaceWith(path.node.consequent);
                    }
                }
            }

            if (test.isUnaryExpression() && test.node.operator === '!') {
                const argument = test.get('argument');
                if (argument.isIdentifier()) {
                    const binding = path.scope.getBinding(argument.node.name);
                    if (binding && binding.constant && t.isVariableDeclarator(binding.path.node)) {
                        const init = binding.path.node.init;
                        if (t.isBooleanLiteral(init)) {
                            const resultValue = !init.value;
                            if (resultValue) path.replaceWith(path.node.consequent);
                            else if (path.node.alternate) path.replaceWith(path.node.alternate);
                            else path.remove();
                        }
                    }
                }
            }

            // handle stuff like Math.random() && !c
            if (test.isLogicalExpression()) {
                const right = test.get('right');

                // check if right side is !identifier
                if (right.isUnaryExpression() && right.node.operator === '!') {
                    const argument = right.get('argument');
                    if (argument.isIdentifier()) {
                        const binding = path.scope.getBinding(argument.node.name);
                        if (binding && binding.constant && t.isVariableDeclarator(binding.path.node)) {
                            const init = binding.path.node.init;

                            if (t.isBooleanLiteral(init)) {
                                const rightValue = !init.value;

                                if (test.node.operator === '&&') {
                                    if (!rightValue) {
                                        // something && false -> always false
                                        if (path.node.alternate) path.replaceWith(path.node.alternate);
                                    } else path.remove();
                                } else {
                                    // something && true -> just test the left side
                                    path.node.test = test.node.left;
                                }
                            } else if (test.node.operator === '||') {
                                // @ts-expect-error my heart breaks
                                const rightValue = init.value;

                                if (rightValue) {
                                    // something || true -> always true
                                    path.replaceWith(path.node.consequent);
                                } else {
                                    // something || false -> just test the left side
                                    path.node.test = test.node.left;
                                }
                            }
                        }
                    }
                }
            }
        },
        ConditionalExpression(path) {
            const test = path.get('test');

            if (test.isBooleanLiteral()) {
                if (test.node.value) path.replaceWith(path.node.consequent);
                else path.replaceWith(path.node.alternate);

                return;
            }

            if (test.isIdentifier()) {
                const binding = path.scope.getBinding(test.node.name);
                if (binding && binding.constant && t.isVariableDeclarator(binding.path.node)) {
                    const init = binding.path.node.init;
                    if (t.isBooleanLiteral(init)) {
                        if (init.value) {
                            path.replaceWith(path.node.consequent);
                        } else {
                            path.replaceWith(path.node.alternate);
                        }
                    }
                }
            }

            if (test.isUnaryExpression() && test.node.operator === '!') {
                const argument = test.get('argument');
                if (argument.isIdentifier()) {
                    const binding = path.scope.getBinding(argument.node.name);
                    if (binding && binding.constant && t.isVariableDeclarator(binding.path.node)) {
                        const init = binding.path.node.init;
                        if (t.isBooleanLiteral(init)) {
                            if (!init.value) path.replaceWith(path.node.consequent);
                            else path.replaceWith(path.node.alternate);
                        }
                    }
                }
            }
        }
    });

    console.log('[ast3] performed general cleanups in', benchmark());

    const foldBinary = (path: NodePath<t.BinaryExpression>) => {
        const { node } = path;

        if (node.operator === '|' && t.isNumericLiteral(node.right) && node.right.value === 0) {
            path.replaceWith(node.left);
            return;
        }

        const getNum = (n: t.Expression): number | null => {
            if (t.isNumericLiteral(n)) return n.value;
            if (t.isUnaryExpression(n) && n.operator === '-' && t.isNumericLiteral(n.argument)) return -n.argument.value;
            return null;
        };

        if (node.left.type === 'PrivateName') return;

        const left = getNum(node.left);
        const right = getNum(node.right);
        if (left === null || right === null) return;

        let result: number | boolean | null = null;
        switch (node.operator) {
            case '+': result = left + right; break;
            case '-': result = left - right; break;
            case '*': result = left * right; break;
            case '/': result = left / right; break;
            case '%': result = left % right; break;
            case '**': result = left ** right; break;
            case '<': result = left < right; break;
            case '<=': result = left <= right; break;
            case '>': result = left > right; break;
            case '>=': result = left >= right; break;
            case '==': result = left == right; break;   // eslint-disable-line
            case '!=': result = left != right; break;   // eslint-disable-line
            case '===': result = left === right; break;
            case '!==': result = left !== right; break;
            default: return;
        }

        if (typeof result === 'number') path.replaceWith(t.numericLiteral(result));
        else if (typeof result === 'boolean') path.replaceWith(t.booleanLiteral(result));
    };

    const collectBinaryPaths = (): NodePath<t.BinaryExpression>[] | null => {
        const pathCache = (traverse as any).cache.path as WeakMap<t.Node, Map<t.Node, NodePath>>;
        const found: NodePath<t.BinaryExpression>[] = [];
        const parents: (t.Node | null)[] = [];
        let complete = true;

        walkAst(ast3, (node, parent) => {
            parents.push(parent);
        }, node => {
            const parent = parents.pop() ?? null;
            if (!t.isBinaryExpression(node)) return;

            const cachedPath = parent ? pathCache.get(parent)?.get(node) : undefined;
            if (cachedPath && cachedPath.node === node) found.push(cachedPath as NodePath<t.BinaryExpression>);
            else complete = false;
        });

        return complete ? found : null;
    };

    const binaryPaths = collectBinaryPaths();

    if (binaryPaths) for (const binaryPath of binaryPaths) foldBinary(binaryPath);
    else traverse(ast3, { BinaryExpression: { exit(path) { foldBinary(path); } } });

    console.log('[ast3] folded binary expressions in', benchmark());

    const inlineScopeConstants = (scope: Scope) => {
        const toInline = new Map<string, t.Expression>();

        for (const [name, binding] of Object.entries(scope.bindings)) {
            if (!binding.constant) continue;
            const decl = binding.path.node;
            if (!t.isVariableDeclarator(decl) || !decl.init) continue;

            const isForLoopVar = binding.path.parentPath?.isForStatement() ||
                binding.path.parentPath?.isForInStatement() ||
                binding.path.parentPath?.isForOfStatement();

            if (isForLoopVar) continue;

            const usedAsCallee = binding.referencePaths.some(ref =>
                t.isCallExpression(ref.parent) && ref.parent.callee === ref.node
            );
            if (usedAsCallee) continue;

            const usedAsMemberObject = binding.referencePaths.some(ref =>
                (t.isMemberExpression(ref.parent) || t.isOptionalMemberExpression(ref.parent)) && ref.parent.object === ref.node
            );
            if (usedAsMemberObject) continue;

            let init = decl.init;

            if (t.isBinaryExpression(init) &&
                t.isNumericLiteral(init.left) &&
                t.isNumericLiteral(init.right)) {
                let result: number | null = null;
                switch (init.operator) {
                    case '+': result = init.left.value + init.right.value; break;
                    case '-': result = init.left.value - init.right.value; break;
                    case '*': result = init.left.value * init.right.value; break;
                    case '/': result = init.left.value / init.right.value; break;
                    case '%': result = init.left.value % init.right.value; break;
                }
                if (result !== null) {
                    decl.init = t.numericLiteral(result);
                    init = decl.init;
                }
            }

            const refs = binding.referencePaths;

            if (!mappings.collapseBlacklists.includes(name)) {
                if (t.isBooleanLiteral(init) || t.isNullLiteral(init) || t.isNumericLiteral(init) || t.isStringLiteral(init)) {
                    if (refs.length > 0) toInline.set(name, init);
                    else if (name.includes('__unusedVar_')) binding.path.remove();
                }
            }
        }

        for (const [name, value] of toInline) {
            const binding = scope.bindings[name];
            for (const ref of binding.referencePaths) {
                if (ref === binding.path.get('id')) continue;

                const refBinding = ref.scope.getBinding(name);
                if (refBinding !== binding) continue;

                if (t.isNullLiteral(value)) ref.replaceWith(t.nullLiteral());
                else if (t.isBooleanLiteral(value)) ref.replaceWith(t.booleanLiteral(value.value));
                else if (t.isNumericLiteral(value)) ref.replaceWith(t.numericLiteral(value.value));
                else if (t.isStringLiteral(value)) ref.replaceWith(t.stringLiteral(value.value));
            }
            binding.path.remove();
        }
    };

    const collectScopes = (): Scope[] | null => {
        const scopeCache = (traverse as any).cache.scope as WeakMap<t.Node, Scope>;
        const scopes: Scope[] = [];
        let complete = true;

        walkAst(ast3, (node, parent) => {
            if (!t.isScopable(node)) return;

            const scope = scopeCache.get(node);
            if (scope && scope.block === node) scopes.push(scope);
            else if (!(t.isBlockStatement(node) && (t.isFunction(parent) || t.isCatchClause(parent)))) complete = false;
        });

        return complete ? scopes : null;
    };

    const inlineScopes = collectScopes();

    if (inlineScopes) for (const scope of inlineScopes) inlineScopeConstants(scope);
    else traverse(ast3, { Scope(path) { inlineScopeConstants(path.scope); } });

    console.log('[ast3] inlined constants in', benchmark());

    const classParamsByName: Record<string, string[]> = {};
    for (const mapping of mappings.classes) {
        if ('constructorParams' in mapping && mapping.constructorParams)
            classParamsByName[mapping.name] = mapping.constructorParams;
    }

    const functionParamsByName: Record<string, string[]> = {};
    for (const mapping of mappings.functions) {
        if ('params' in mapping && mapping.params)
            functionParamsByName[mapping.name] = mapping.params;
    }

    const classMethodParamsByName: Record<string, Record<string, string[]>> = {};
    for (const mapping of mappings.classes) {
        if ('methodParams' in mapping && mapping.methodParams)
            classMethodParamsByName[mapping.name] = mapping.methodParams;
    }

    const functionMethodParamsByName: Record<string, Record<string, string[]>> = {};
    for (const mapping of mappings.functions) {
        if ('methodParams' in mapping && mapping.methodParams)
            functionMethodParamsByName[mapping.name] = mapping.methodParams;
    }

    const knownClassNames = new Set(mappings.classes.map(m => m.name));
    const knownFunctionNames = new Set(mappings.functions.map(m => m.name));

    const isBabylon = (name: string) => name.startsWith('BABYLON_');

    const decompReport: string[] = [];
    const pushDecomp = (name: string, line: string) => { if (!isBabylon(name)) decompReport.push(line); };

    const describeParams = (params: t.Node[]): string => params.map(p => {
        if (t.isIdentifier(p)) return p.name;
        if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) return p.left.name;
        if (t.isRestElement(p) && t.isIdentifier(p.argument)) return `...${p.argument.name}`;
        return '?';
    }).join(', ');

    const applyConstructorParams = (classPath: NodePath<t.ClassExpression | t.ClassDeclaration>, className: string) => {
        if (!knownClassNames.has(className)) return;

        const params = classParamsByName[className];

        const constructorPath = classPath.get('body').get('body').find(
            (item): item is NodePath<t.ClassMethod> => item.isClassMethod() && item.node.kind === 'constructor'
        );

        if (constructorPath) {
            if (params) renameParamsByPosition(constructorPath, params);
            else if (constructorPath.node.params.length > 0)
                pushDecomp(className, `[class] ${className}.constructor(${describeParams(constructorPath.node.params)}): not mapped`);
        }

        const methodParams = classMethodParamsByName[className];

        for (const item of classPath.get('body').get('body')) {
            if (!item.isClassMethod() || item.node.kind === 'constructor' || item.node.kind === 'get') continue;
            if (item.node.computed || !t.isIdentifier(item.node.key)) continue;
            if (item.node.params.length === 0) continue;

            const params = methodParams?.[item.node.key.name];
            if (params) renameParamsByPosition(item, params);
            else pushDecomp(className, `[class] ${className}.${item.node.key.name}(${describeParams(item.node.params)}): not mapped`);
        }
    };

    const applyFunctionParams = (fnPath: NodePath<t.Function>, name: string) => {
        if (!knownFunctionNames.has(name)) return;

        const params = functionParamsByName[name];
        if (params) renameParamsByPosition(fnPath, params);
        else if (fnPath.node.params.length > 0)
            pushDecomp(name, `[function] ${name}(${describeParams(fnPath.node.params)}): not mapped`);
    };

    const applyParamNamesFast = (): boolean => {
        const ops: { fn: t.Function; owner: string; label: string; names: string[] | undefined }[] = [];

        const collectClass = (classNode: t.ClassExpression | t.ClassDeclaration, className: string) => {
            if (!knownClassNames.has(className)) return;

            const constructor = classNode.body.body.find(item => t.isClassMethod(item) && item.kind === 'constructor');
            if (constructor) ops.push({ fn: constructor as t.ClassMethod, owner: className, label: `[class] ${className}.constructor`, names: classParamsByName[className] });

            const methodParams = classMethodParamsByName[className];

            for (const item of classNode.body.body) {
                if (!t.isClassMethod(item) || item.kind === 'constructor' || item.kind === 'get') continue;
                if (item.computed || !t.isIdentifier(item.key)) continue;
                if (item.params.length === 0) continue;

                ops.push({ fn: item, owner: className, label: `[class] ${className}.${item.key.name}`, names: methodParams?.[item.key.name] });
            }
        };

        const collectFunction = (fn: t.Function, name: string) => {
            if (!knownFunctionNames.has(name)) return;
            ops.push({ fn, owner: name, label: `[function] ${name}`, names: functionParamsByName[name] });
        };

        walkAst(ast3, node => {
            if (t.isClassDeclaration(node)) {
                if (t.isIdentifier(node.id)) collectClass(node, node.id.name);
            } else if (t.isVariableDeclarator(node)) {
                if (!t.isIdentifier(node.id) || !node.init) return;

                if (t.isClassExpression(node.init)) collectClass(node.init, node.id.name);
                else if (t.isFunctionExpression(node.init) || t.isArrowFunctionExpression(node.init)) collectFunction(node.init, node.id.name);
            } else if (t.isAssignmentExpression(node)) {
                const { left, right } = node;
                if (!t.isFunctionExpression(right)) return;
                if (!t.isMemberExpression(left) || left.computed || !t.isIdentifier(left.property)) return;

                const objExpr = left.object;
                if (!t.isMemberExpression(objExpr) || objExpr.computed) return;
                if (!t.isIdentifier(objExpr.property, { name: 'prototype' })) return;
                if (!t.isIdentifier(objExpr.object)) return;

                const ownerName = objExpr.object.name;
                if (!knownFunctionNames.has(ownerName)) return;

                ops.push({ fn: right, owner: ownerName, label: `[function] ${ownerName}.${left.property.name}`, names: functionMethodParamsByName[ownerName]?.[left.property.name] });
            } else if (t.isFunctionDeclaration(node)) {
                if (t.isIdentifier(node.id)) collectFunction(node, node.id.name);
            }
        });

        const scopeCache = (traverse as any).cache.scope as WeakMap<t.Node, Scope>;
        const scopes = new Map<t.Function, Scope>();

        for (const op of ops) {
            if (!op.names) continue;

            const scope = scopeCache.get(op.fn);
            if (!scope || scope.block !== op.fn) return false;
            scopes.set(op.fn, scope);
        }

        for (const { fn, owner, label, names } of ops) {
            if (names) {
                fn.params.forEach((param, i) => {
                    const newName = names[i];
                    if (!newName || !t.isIdentifier(param)) return;

                    const oldName = param.name;
                    if (oldName === newName) return;

                    try {
                        scopes.get(fn)!.rename(oldName, newName);
                    } catch (e) {
                        console.warn(`failed to rename param ${oldName} -> ${newName}:`, e);
                    }
                });
            } else if (fn.params.length > 0) pushDecomp(owner, `${label}(${describeParams(fn.params)}): not mapped`);
        }

        return true;
    };

    if (!applyParamNamesFast()) traverse(ast3, {
        ClassDeclaration(path) {
            if (t.isIdentifier(path.node.id)) applyConstructorParams(path, path.node.id.name);
        },
        VariableDeclarator(path) {
            if (!t.isIdentifier(path.node.id)) return;

            const name = path.node.id.name;
            const init = path.node.init;
            if (!init) return;

            if (t.isClassExpression(init)) {
                applyConstructorParams(path.get('init') as NodePath<t.ClassExpression>, name);
                return;
            }

            if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init))
                applyFunctionParams(path.get('init') as NodePath<t.FunctionExpression | t.ArrowFunctionExpression>, name);
        },
        // `X.prototype.method = function (e) {}`
        AssignmentExpression(path) {
            const { left, right } = path.node;
            if (!t.isFunctionExpression(right)) return;
            if (!t.isMemberExpression(left) || left.computed || !t.isIdentifier(left.property)) return;

            const objExpr = left.object;
            if (!t.isMemberExpression(objExpr) || objExpr.computed) return;
            if (!t.isIdentifier(objExpr.property, { name: 'prototype' })) return;
            if (!t.isIdentifier(objExpr.object)) return;

            const ownerName = objExpr.object.name;
            if (!knownFunctionNames.has(ownerName)) return;

            const params = functionMethodParamsByName[ownerName]?.[left.property.name];
            if (params) renameParamsByPosition(path.get('right') as NodePath<t.FunctionExpression>, params);
            else if (right.params.length > 0)
                pushDecomp(ownerName, `[function] ${ownerName}.${left.property.name}(${describeParams(right.params)}): not mapped`);
        },
        FunctionDeclaration(path) {
            if (t.isIdentifier(path.node.id)) applyFunctionParams(path, path.node.id.name);
        }
    });

    console.log('[ast3] applied constructor/function param names in', benchmark());

    const decompReportPath = path.join(import.meta.dirname, '..', '..', '..', 'worksp', 'missing-params.report');
    const decompReportBody = [
        `missing-params.report - ${new Date().toLocaleString()}`,
        '',
        `== unmapped (${decompReport.length}) ==`,
        ...(decompReport.length ? decompReport : ['(none)']),
        ''
    ].join('\n');

    fs.mkdirSync(path.dirname(decompReportPath), { recursive: true });
    fs.writeFileSync(decompReportPath, decompReportBody);
    console.log(`[ast3] wrote ${decompReport.length} unmapped entries to`, decompReportPath);

    const finalCode = generate(ast3, { retainLines: false, compact: false }).code;
    console.log('[ast3] generated final code in', benchmark());

    console.log('AST finished in', (((Date.now() - start) / 1000).toFixed(3) + 's'));

    return finalCode;
}

export default buildMappedFile;