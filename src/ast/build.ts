import generate from '@babel/generator';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

import cleanup from '../cleanup';
import mappings from '../mappings';

import {
    addMapping,
    checkArrayOfObjects,
    getClassProperties,
    getObjectKeys,
    sortClassMembers,
    type IdentifierMapping
} from './util';

const buildMappedFile = (inputJS: string): string => {
    inputJS = cleanup(inputJS);

    const start = Date.now();
    let lastBench = Date.now();
    const benchmark = () => {
        const bench = ((Date.now() - lastBench) / 1000).toFixed(3) + 's';
        lastBench = Date.now();
        return bench;
    }

    console.log('inputJS size:', inputJS.length);

    const ast = parser.parse(inputJS, { sourceType: 'module' });

    console.log('[ast1] parsed! starting compilation in', benchmark());

    const classRenames: IdentifierMapping = {}; // class X {}
    const variableRenames: IdentifierMapping = {}; // var/let/const x = y
    const functionRenames: IdentifierMapping = {}; // function x() {}

    let commCodeVarName: string | null = null;

    const variableRegexes = mappings.variables.filter(m => m.regex && !m.after).map(m => ({
        name: m.name,
        regex: new RegExp(m.regex!, 'g')
    }));

    for (const { name, regex } of variableRegexes) {
        regex.lastIndex = 0;
        const match = regex.exec(inputJS);

        if (match && match[1]) {
            variableRenames[match[1]] = name;
            if (name === 'CommCode') commCodeVarName = match[1];
        }
    }

    console.log('[ast1] matched variable regexes in', benchmark());

    // function regexes that are after = false
    const functionRegexes = mappings.functions.filter(m => 'regex' in m).filter(m => m.regex && !m.after).map(m => ({
        name: m.name,
        regex: new RegExp(m.regex, 'g')
    }));

    for (const { name, regex } of functionRegexes) {
        regex.lastIndex = 0;
        const match = regex.exec(inputJS);

        if (match && match[1]) {
            functionRenames[match[1]] = name;
        }
    }

    console.log('[ast1] matched function regexes in', benchmark());

    if (commCodeVarName) {
        const commCodePropertyMap: { [key: string]: string } = {};

        traverse(ast, {
            VariableDeclarator(path) {
                if (!t.isIdentifier(path.node.id)) return;
                if (path.node.id.name !== commCodeVarName) return;
                if (!path.node.init || !t.isObjectExpression(path.node.init)) return;

                // remap CommCode properties
                for (const prop of path.node.init.properties) {
                    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                        const obfuscatedKey = prop.key.name;

                        // find the readable name from commCodes
                        for (const [readableName, obfuscatedValue] of Object.entries(mappings.commCodes)) {
                            if (obfuscatedValue === obfuscatedKey) {
                                // console.log(`commcode property mapping: ${obfuscatedKey} -> ${readableName}`);
                                commCodePropertyMap[obfuscatedKey] = readableName;
                                prop.key.name = readableName;
                                break;
                            }
                        }
                    }
                }
            }
        });

        // remap all "member expressions" that access CommCode properties
        traverse(ast, {
            MemberExpression(path) {
                // check if this is accessing CommCode (e.g., CommCode.zW or x.zW where x is the obfuscated name)
                if (!t.isIdentifier(path.node.object)) return;
                if (path.node.object.name !== commCodeVarName) return;
                if (path.node.computed) return;
                if (!t.isIdentifier(path.node.property)) return;

                const obfuscatedProp = path.node.property.name;
                const readableProp = commCodePropertyMap[obfuscatedProp];

                if (readableProp) {
                    // console.log(`remapping CommCode.${obfuscatedProp} -> CommCode.${readableProp}`);
                    path.node.property.name = readableProp;
                }
            }
        });
    }

    console.log('[ast1] replaced CommCode mappings in', benchmark());

    // `var` | `let` | `const` stuff
    traverse(ast, {
        ClassExpression(path) {
            sortClassMembers(path.node.body);
        },
        ClassDeclaration(path) {
            sortClassMembers(path.node.body);
        },
        VariableDeclarator(path) {
            if (path.node.init && t.isClassExpression(path.node.init))
                sortClassMembers(path.node.init.body);

            if (!t.isIdentifier(path.node.id)) return;

            const varName = path.node.id.name;
            const init = path.node.init;

            if (!init) return;

            // var X = class y {}
            if (t.isClassExpression(init)) {
                const classProps = getClassProperties(init.body);

                // check hasProps mappings
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
                        // try to find a return statement with a string literal
                        let returnedName: string | null = null;

                        traverse(getClassNameMethod, {
                            ReturnStatement(returnPath) {
                                if (t.isStringLiteral(returnPath.node.argument)) {
                                    returnedName = returnPath.node.argument.value;
                                    returnPath.stop();
                                }
                            }
                        }, path.scope);

                        if (returnedName) {
                            const babylonName = `BABYLON_${returnedName}`;
                            variableRenames[varName] = babylonName;
                            return;
                        }
                    } catch (e) {
                        console.warn(`Failed to extract getClassName for ${varName}:`, e);
                    }
                }

                // check constructorHasCode mappings
                const constructor = init.body.body.find(
                    item => t.isClassMethod(item) && item.kind === 'constructor'
                ) as t.ClassMethod | undefined;

                if (constructor) {
                    const constructorCode = generate(constructor, { compact: false }).code;

                    for (const mapping of mappings.classes) {
                        if ('constructorHasCode' in mapping) {
                            const found = constructorCode.includes(mapping.constructorHasCode);
                            if (found) {
                                variableRenames[varName] = mapping.name;

                                // handle mapping.constructorParams if it exists
                                if (mapping.constructorParams && Array.isArray(mapping.constructorParams)) {
                                    const funcParams = constructor.params;

                                    if (funcParams.length !== mapping.constructorParams.length) {
                                        console.warn(
                                            `Parameter count mismatch for class ${varName} (${mapping.name}) constructor: ` +
                                            `expected ${mapping.constructorParams.length}, got ${funcParams.length}`
                                        );
                                    } else funcParams.forEach((param, index) => {
                                        if (mapping.constructorParams && t.isIdentifier(param)) {
                                            const oldParamName = param.name;
                                            const newParamName = mapping.constructorParams[index];

                                            variableRenames[oldParamName] = newParamName;
                                        }
                                    });
                                }

                                return;
                            }
                        }
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

                                const parentScope = path.scope;
                                const binding = parentScope.getBinding(nameVarName);

                                if (binding && t.isVariableDeclarator(binding.path.node)) {
                                    const init = binding.path.node.init;

                                    if (t.isStringLiteral(init)) {
                                        const extensionName = init.value;

                                        variableRenames[varName] = `BABYLON_LoaderExt_${extensionName}`;
                                        variableRenames[nameVarName] = `BABYLON_LoaderExtName_${extensionName}`;

                                        // console.log(`mapped loader extension: ${varName} -> BABYLON_LoaderExt_${extensionName}`);
                                        // console.log(`mapped loader ext name: ${nameVarName} -> BABYLON_LoaderExtName_${extensionName}`);

                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // var X = () => {}
            if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) {
                const funcCode = generate(init, { compact: false }).code;

                for (const mapping of mappings.functions) {
                    if ('hasCode' in mapping && mapping.hasCode && !mapping.after) {
                        const found = funcCode.includes(mapping.hasCode);
                        if (found) {
                            variableRenames[varName] = mapping.name;
                            return;
                        }
                    }
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

                    const className = path.node.left.object.name;
                    const classNameValue = path.node.right.value;
                    const babylonName = `BABYLON_${classNameValue}`;

                    variableRenames[className] = babylonName;
                }
            } catch { }
        }
    });

    console.log('[ast1] ran automatic babylon remapping & class remapping in', benchmark());

    traverse(ast, {
        FunctionDeclaration(path) {
            if (!t.isIdentifier(path.node.id)) return;

            const funcName = path.node.id.name;

            try {
                const funcCode = generate(path.node, { compact: false }).code;

                for (const mapping of mappings.functions) {
                    if ('hasCode' in mapping && mapping.hasCode && !mapping.after) {
                        const found = funcCode.includes(mapping.hasCode);
                        if (found) {
                            functionRenames[funcName] = mapping.name;
                            return;
                        }
                    }
                }
            } catch (e) {
                console.warn(`failed to process function ${funcName}:`, e);
            }
        }
    });

    console.log('[ast1] ran function remapping in', benchmark());

    console.log('[ast1] functionRenames:', functionRenames);

    traverse(ast, {
        VariableDeclarator(path) {
            if (!t.isIdentifier(path.node.id)) return;

            const varName = path.node.id.name;
            const init = path.node.init;

            if (!init) return;

            // `mappings.objects`
            if (t.isObjectExpression(init)) {
                const keys = getObjectKeys(init);

                for (const mapping of mappings.objects) {
                    if (mapping.hasKeys && mapping.hasKeys.every(key => keys.includes(key))) {
                        if (mapping.keyCount && keys.length !== mapping.keyCount) continue;

                        variableRenames[varName] = mapping.name;
                    }
                }
            }

            // `mappings.constants`
            if (t.isArrayExpression(init)) {
                for (const mapping of mappings.constants) {
                    if (mapping.objectHasProps && checkArrayOfObjects(init, mapping.objectHasProps))
                        variableRenames[varName] = mapping.name;
                }
            }
        }
    });

    console.log('[ast1] processed objects/arrays in', benchmark());

    const allRenames: IdentifierMapping = { ...classRenames, ...variableRenames, ...functionRenames };

    traverse(ast, {
        Identifier(path) {
            const oldName = path.node.name;
            const newName = allRenames[oldName];
            if (!newName || typeof newName !== 'string') return;

            const parent = path.parent;

            // skip object direct prop keys
            if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) return;
            // skip class method names
            if (t.isClassMethod(parent) && parent.key === path.node && !parent.computed) return;
            // skip import/export (shouldn't be in shell but anyway) 
            if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
            // skip object method names
            if (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed) return;
            // skip like x.this on items that aren't like x[this] idk
            if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === path.node && !parent.computed) return;

            path.node.name = newName;
        }
    });

    console.log('[ast1] renamed all identifiers in', benchmark());

    inputJS = generate(ast, { retainLines: false, compact: false }).code;
    console.log('[ast1] generated in', benchmark());

    process.getBuiltinModule('fs').writeFileSync('./ast2.js', inputJS);

    const ast2 = parser.parse(inputJS, { sourceType: 'module' });

    console.log('[ast2] starting w/ 0 syntax errors');

    const babylonMap: IdentifierMapping = {};

    // time to do some advanced babylon whateverthisis

    /*
    var Qt = {};
    $VAR9(Qt, {
    shadowMapFragment: () => Jt
    */

    // { name: 'BABYLON_assignToObject', regex: /([A-z0-9$_]+)\([A-z], \{\s*bonesDeclarationWGSL:/ },

    const assignToObjectRegex = /([A-z0-9$_]+)\([A-z0-9$_]+, \{\s*bonesDeclaration(?:WGSL)?:/;
    const assignToObject = inputJS.match(assignToObjectRegex)?.[1];

    const shaderAccessorRegex = new RegExp(`var ([A-z0-9$_]+) = \\{\\};\\s*${assignToObject}\\(([A-z0-9$_]+), \\{\\s*([A-z0-9$_]+): \\(\\) \\=> ([A-z0-9$_]+)`, 'g');
    const shaderAccesssorMatches = Array.from(inputJS.matchAll(shaderAccessorRegex));

    for (const match of shaderAccesssorMatches) {
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
    const createShaderRegex = /([A-z0-9$_]+)\(\{\s*"..\/node_modules\/@babylonjs\/core\/Shaders\/ShadersInclude/;
    const createShader = inputJS.match(createShaderRegex)?.[1];
    if (!createShader) console.error('failed to find createShader function name');

    // { name: 'BABYLON_ensureShaderStore', regex: /postprocess.vertex.js"\(\) \{\s*([A-z0-9$_]+)\(\);/ },
    const ensureShaderStoreRegex = /postprocess\.vertex\.js"\(\) \{\s*([A-z0-9$_]+)\(\);/;
    const ensureShaderStore = inputJS.match(ensureShaderStoreRegex)?.[1];
    if (!ensureShaderStore) console.error('failed to find BABYLON_ensureShaderStore function name');

    const shaderFactoryRegex = new RegExp(`var ([A-z0-9$_]+) = ${createShader}\\(\\{\\s*"[^"]+"\\(\\) \\{\\s*${ensureShaderStore}\\(\\);\\s*(?:[A-z0-9$_]+\\(\\);\\s*)*([A-z0-9$_]+) = "([A-z0-9$_]+)";\\s*([A-z0-9$_]+) = "`, 'g');
    const shaderFactoryMatches = Array.from(inputJS.matchAll(shaderFactoryRegex));

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
    const shaderIncludeRegex = new RegExp(`var ([A-z0-9$_]+) = ${createShader}\\(\\{\\s*"[^"]+"\\(\\) \\{\\s*${ensureShaderStore}\\(\\);\\s*(?:(?:[A-z0-9$_]+\\(\\);|"[^"]*";)\\s*)*[A-z0-9$_]+\\.IncludesShadersStore(?:WGSL)?\\.([A-z0-9$_]+) = "`, 'g');
    const shaderIncludeMatches = Array.from(inputJS.matchAll(shaderIncludeRegex));

    for (const match of shaderIncludeMatches) {
        if (match[1] && match[2]) {
            // match[1] = the shader include factory
            // match[2] = the shader name
            if (match[1].length === 2) addMapping(babylonMap, match[1], `BABYLON_ShaderIncludeFactory_${match[2]}`);
        }
    }

    console.log(babylonMap);

    traverse(ast2, {
        Identifier(path) {
            const oldName = path.node.name;
            if (!Object.hasOwn(babylonMap, oldName)) return;

            const newName = babylonMap[oldName];
            if (!newName || typeof newName !== 'string') return console.warn(`skipping invalid mapping for ${oldName}: ${newName}`);

            const parent = path.parent;

            // skip object direct prop keys
            if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) return;
            // skip class method names
            if (t.isClassMethod(parent) && parent.key === path.node && !parent.computed) return;
            // skip import/export (shouldn't be in shell but anyway) 
            if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
            // skip object method names
            if (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed) return;
            // skip like x.this on items that aren't like x[this] idk
            if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === path.node && !parent.computed) return;

            const isInSwitchForClass = !!path.findParent(p => t.isSwitchStatement(p.node) || t.isForStatement(p.node));
            if (!isInSwitchForClass) path.node.name = newName;
        }
    });

    console.log('[ast1] mapped babylon shaders in', benchmark());

    const ast2Map: IdentifierMapping = {};

    const precompiledRegexes2ndPass = mappings.variables.filter(m => m.regex && m.after).map(mapping => ({
        name: mapping.name,
        regex: new RegExp(mapping.regex!, 'g')
    }));

    for (const { name, regex } of precompiledRegexes2ndPass) {
        regex.lastIndex = 0;
        const match = regex.exec(inputJS);

        if (match && match[1]) addMapping(ast2Map, match[1], name);
    }

    console.log('[ast2] executed variable mappings (pass 2) in', benchmark());

    const precompiledFunctionRegexes2ndPass = mappings.functions.filter(m => 'regex' in m).filter(m => m.regex && m.after).map(m => ({
        name: m.name,
        regex: new RegExp(m.regex!, 'g')
    }));

    for (const { name, regex } of precompiledFunctionRegexes2ndPass) {
        regex.lastIndex = 0;
        const match = regex.exec(inputJS);

        if (match && match[1]) addMapping(ast2Map, match[1], name);
    }

    traverse(ast2, {
        FunctionDeclaration(path) {
            if (!t.isIdentifier(path.node.id)) return;

            const funcName = path.node.id.name;

            try {
                const funcCode = generate(path.node, { compact: false }).code;

                for (const mapping of mappings.functions) {
                    if ('hasCode' in mapping && mapping.hasCode && mapping.after) {
                        const found = funcCode.includes(mapping.hasCode);
                        if (found) return addMapping(ast2Map, funcName, mapping.name);
                    }
                }
            } catch (e) {
                console.warn(`Failed to process function ${funcName}:`, e);
            }
        }
    });

    console.log('[ast2] identified function mappings (pass 2) in', benchmark());

    traverse(ast2, {
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

    console.log('[ast2] renamed identifiers in', benchmark());

    const propRegexes = mappings.props.filter(m => m.regex && !m.after).map(m => ({
        name: m.name,
        regex: new RegExp(m.regex.source, 'g')
    }));

    const propertyRenames: IdentifierMapping = {};

    for (const { name, regex } of propRegexes) {
        regex.lastIndex = 0;
        const match = regex.exec(inputJS);

        if (match && match[1]) propertyRenames[match[1]] = name;
    }

    console.log('[ast2] executed property mappings (pass 1) in', benchmark());
    console.log('propertyRenames', propertyRenames);

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

    for (let i = 0; i < 18; i++) {
        accurateNamesArray.unshift('');
    }

    constantNames.forEach((constName, index) => {
        if (parameterRenames[constName]) return;

        const accurateName = accurateNamesArray[index];
        if (accurateName && constName !== accurateName) parameterRenames[constName] = accurateName;
    });

    console.log('[ast2] processed parameterRenames', parameterRenames);

    traverse(ast2, {
        ClassDeclaration(path) {
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
            const isForLoopVar = path.parentPath.isForStatement() || path.parentPath.isForInStatement() || path.parentPath.isForOfStatement();

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
                                // undo shorthand (like { x } -> { x: x })
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

            // skip object direct prop keys
            if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) return;
            // skip class method names
            if (t.isClassMethod(parent) && parent.key === path.node && !parent.computed) return;
            // skip import/export (shouldn't be in shell but anyway) 
            if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
            // skip object method names
            if (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed) return;
            // skip non-computed member expression properties
            if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === path.node && !parent.computed) return;

            path.node.name = newName;
        }
    });

    console.log('[ast2] renamed identifiers in', benchmark());

    inputJS = generate(ast2, { retainLines: false, compact: false }).code;
    console.log('completed JS codegen for 2nd pass in', benchmark());

    const ast3 = parser.parse(inputJS, { sourceType: 'module' });

    console.log('[ast3] starting w/ 0 syntax errors');

    const switchRegexes = mappings.commSwitch.filter(m => m.regex).map(m => ({
        name: m.name,
        regex: new RegExp(m.regex!, 'g')
    }));

    traverse(ast3, {
        SwitchStatement(path) {
            const forLoopParent = path.findParent(p => t.isForStatement(p.node));
            if (forLoopParent) {
                const forLoopEvaluator = forLoopParent.get('test');
                const string = forLoopEvaluator.toString();
                if (string.includes('isMoreDataAvailable')) {
                    const fullForLoopCode = forLoopParent.toString();

                    const switchRenames: IdentifierMapping = {};

                    for (const { name, regex } of switchRegexes) {
                        regex.lastIndex = 0;

                        const match = regex.exec(fullForLoopCode);
                        if (match && match[1]) {
                            switchRenames[match[1]] = name;
                            console.log(`CommSwitch mapping: ${match[1]} -> ${name}`);
                        }
                    }

                    traverse(path.node, {
                        Identifier(path) {
                            const oldName = path.node.name;
                            const newName = switchRenames[oldName];
                            if (!newName) return;

                            const parent = path.parent;

                            // skip object direct prop keys
                            if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) return;
                            // skip class method names
                            if (t.isClassMethod(parent) && parent.key === path.node && !parent.computed) return;
                            // skip import/export (shouldn't be in shell but anyway) 
                            if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
                            // skip object method names
                            if (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed) return;
                            // skip non-computed member expression properties
                            if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === path.node && !parent.computed) return;

                            path.node.name = newName;
                            console.log(`Remapped CommSwitch identifier: ${oldName} -> ${newName}`);
                        }
                    }, path.scope);
                }
            }
        }
    });

    console.log('[ast3] processed comm switch mappings in', benchmark());

    const afterProps = mappings.props.filter(m => m.regex && m.after).map(m => ({
        name: m.name,
        regex: new RegExp(m.regex!.source, 'g')
    }));

    const afterPropertyRenames: IdentifierMapping = {};

    for (const { name, regex } of afterProps) {
        regex.lastIndex = 0;
        const match = regex.exec(inputJS);

        if (match && match[1]) afterPropertyRenames[match[1]] = name;
    }

    traverse(ast3, {
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

            const oldName = path.node.property.name;
            const newName = afterPropertyRenames[oldName];

            if (newName && typeof newName === 'string') path.node.property.name = newName;
        },
        Identifier(path) {
            const oldName = path.node.name;
            const parent = path.parent;

            // skip object direct prop keys
            if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) return;
            // skip class method names
            if (t.isClassMethod(parent) && parent.key === path.node && !parent.computed) return;
            // skip import/export (shouldn't be in shell but anyway) 
            if (t.isImportSpecifier(parent) || t.isExportSpecifier(parent)) return;
            // skip object method names
            if (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed) return;
            // skip toplevel variables that aren't properties (i.e. var dontRemapThis = { butDoThis: 1 };)
            if (t.isVariableDeclarator(parent) && parent.id === path.node) return;
            // skip extends clause (class extends THISTHING)
            if ((t.isClassDeclaration(parent) || t.isClassExpression(parent)) && parent.superClass === path.node) return;

            const newName = afterPropertyRenames[oldName];
            if (newName && typeof newName === 'string') path.node.name = newName;
        }
    });

    console.log('[ast3] finished ALL renames in', benchmark());

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

            path.node.declarations.forEach(decl => {
                if (!t.isIdentifier(decl.id)) return;

                const binding = path.scope.getBinding(decl.id.name);
                if (!binding || !binding.constant) return;

                const init = decl.init;
                if (t.isNumericLiteral(init)) {
                    const actualRefs = binding.referencePaths.filter(ref => ref !== binding.path.get('id'));

                    const canInline = actualRefs.every(refPath => {
                        const parent = refPath.parent;
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

                binding.referencePaths.forEach(refPath => {
                    if (refPath === binding.path.get('id')) return;

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
        BinaryExpression(path) {
            if (path.node.operator === '|' &&
                t.isNumericLiteral(path.node.right) &&
                path.node.right.value === 0) {
                // replace `x | 0` with just `x`
                path.replaceWith(path.node.left);
            }

            if (t.isNumericLiteral(path.node.left) && t.isNumericLiteral(path.node.right)) {
                let result: number | null = null;

                switch (path.node.operator) {
                    case '+': result = path.node.left.value + path.node.right.value; break;
                    case '-': result = path.node.left.value - path.node.right.value; break;
                    case '*': result = path.node.left.value * path.node.right.value; break;
                    case '/': result = path.node.left.value / path.node.right.value; break;
                    case '%': result = path.node.left.value % path.node.right.value; break;
                    case '**': result = path.node.left.value ** path.node.right.value; break;
                }

                if (result !== null) path.replaceWith(t.numericLiteral(result));
            }
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

    const forAST4 = generate(ast3, { retainLines: false, compact: false }).code;
    console.log('completed finalCode generation in', benchmark());

    const ast4 = parser.parse(forAST4, { sourceType: 'module' });

    console.log('[ast4] starting final cleanup w/ 0 syntax errors');

    traverse(ast4, {
        VariableDeclaration(path) {
            const constantsToRemove = new Map<string, t.Expression>();

            path.node.declarations.forEach(decl => {
                if (!t.isIdentifier(decl.id)) return;

                const binding = path.scope.getBinding(decl.id.name);
                if (!binding || !binding.constant) return;

                let init = decl.init;
                if (!init) return;

                // evaluate simple math (like 1 + 1)
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
                        init = decl.init; // update init for future processing
                    }
                }

                // mark null/boolean literals for potential removal
                if ((t.isBooleanLiteral(init) || t.isNullLiteral(init))) {
                    const actualRefs = binding.referencePaths.filter(ref => ref !== binding.path.get('id'));

                    if (actualRefs.length === 0) {
                        constantsToRemove.set(decl.id.name, init);
                    } else {
                        const allRefsAreInObjectProps = actualRefs.every(refPath => {
                            const parent = refPath.parent;
                            return t.isObjectProperty(parent) && parent.value === refPath.node;
                        });

                        if (allRefsAreInObjectProps) {
                            constantsToRemove.set(decl.id.name, init);
                        }
                    }
                }

                // handle numeric literals for inlining (including evaluated ones)
                if (t.isNumericLiteral(init)) {
                    const actualRefs = binding.referencePaths.filter(ref => ref !== binding.path.get('id'));

                    if (actualRefs.length > 0) constantsToRemove.set(decl.id.name, init);
                }
            });

            // second pass: replace all references with actual values
            for (const [varName, value] of constantsToRemove) {
                const binding = path.scope.getBinding(varName);
                if (!binding) continue;

                binding.referencePaths.forEach(refPath => {
                    if (refPath === binding.path.get('id')) return;

                    if (t.isNullLiteral(value)) {
                        refPath.replaceWith(t.nullLiteral());
                    } else if (t.isBooleanLiteral(value)) {
                        refPath.replaceWith(t.booleanLiteral(value.value));
                    } else if (t.isNumericLiteral(value)) {
                        refPath.replaceWith(t.numericLiteral(value.value));
                    }
                });
            }

            // third pass: remove the declarations for these variables
            path.node.declarations = path.node.declarations.filter(decl => {
                if (!t.isIdentifier(decl.id)) return true;

                const varName = decl.id.name;

                if (constantsToRemove.has(varName)) {
                    console.log(`Removing unused constant: ${varName}`);
                    return false;
                }

                return true;
            });

            if (path.node.declarations.length === 0) path.remove();
        },
        BinaryExpression(path) {
            // remove `x | 0`
            if (path.node.operator === '|' &&
                t.isNumericLiteral(path.node.right) &&
                path.node.right.value === 0) {
                path.replaceWith(path.node.left);
                return;
            }

            const getNumericValue = (node: t.Node): number | null => {
                if (t.isNumericLiteral(node)) return node.value;
                if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) return -node.argument.value;
                return null;
            };

            const leftValue = getNumericValue(path.node.left);
            const rightValue = getNumericValue(path.node.right);

            // evaluate constant math
            if (leftValue !== null && rightValue !== null) {
                let result: number | boolean | null = null;

                switch (path.node.operator) {
                    case '+': result = leftValue + rightValue; break;
                    case '-': result = leftValue - rightValue; break;
                    case '*': result = leftValue * rightValue; break;
                    case '/': result = leftValue / rightValue; break;
                    case '%': result = leftValue % rightValue; break;
                    case '**': result = leftValue ** rightValue; break;
                    case '<': result = leftValue < rightValue; break;
                    case '<=': result = leftValue <= rightValue; break;
                    case '>': result = leftValue > rightValue; break;
                    case '>=': result = leftValue >= rightValue; break;
                    // eslint-disable-next-line eqeqeq
                    case '==': result = leftValue == rightValue; break;
                    case '===': result = leftValue === rightValue; break;
                    // eslint-disable-next-line eqeqeq
                    case '!=': result = leftValue != rightValue; break;
                    case '!==': result = leftValue !== rightValue; break;
                }

                if (result !== null) {
                    if (typeof result === 'number') path.replaceWith(t.numericLiteral(result));
                    else if (typeof result === 'boolean') path.replaceWith(t.booleanLiteral(result));
                }
            }
        }
    });

    const finalCode = generate(ast4, { retainLines: false, compact: false }).code;

    console.log('fully done in', (((Date.now() - start) / 1000).toFixed(3) + 's'));

    return finalCode;
}

export default buildMappedFile;