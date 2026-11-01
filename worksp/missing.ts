import generate from '@babel/generator';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import fs from 'node:fs';

const input = fs.readFileSync(process.argv[2], 'utf-8');
const isHome = input.includes('createElementVNode');

const ast = parser.parse(input, { sourceType: 'module' });

const suspicious = {
    variables: new Set<string>(),
    functions: new Set<string>(),
    properties: new Set<string>(),
    classes: new Set<string>(),
    parameters: new Set<string>(),
};

const isObfuscated = (name: string) => {
    if (isHome) return /^[a-zA-Z$_]([a-zA-Z0-9$_]?)$/.test(name);
    else return /^[a-zA-Z$_][a-zA-Z0-9$_]$/.test(name);
}

const shadowGenIdx = input.indexOf('var shadowGen;');
const shadowGenPos = shadowGenIdx === -1 ? 0 : shadowGenIdx;

traverse(ast, {
    Identifier(path) {
        const { name } = path.node;
        if (!isObfuscated(name)) return;

        const parent = path.parent;

        if (t.isVariableDeclarator(parent) && parent.id === path.node) {
            const inCommSwitch = path.findParent(p =>
                t.isSwitchStatement(p.node) &&
                t.isIdentifier(p.node.discriminant) &&
                p.node.cases.some(c => c.consequent.some(s => generate(s).code.includes('isMoreDataAvailable')))
            );
            if (!inCommSwitch) suspicious.variables.add(name);
            return;
        }

        if (t.isFunctionDeclaration(parent) && parent.id === path.node) {
            suspicious.functions.add(name);
            return;
        }

        if (t.isFunctionExpression(parent) && parent.id === path.node) {
            suspicious.functions.add(name);
            return;
        }

        if ((t.isClassDeclaration(parent) || t.isClassExpression(parent)) && parent.id === path.node) {
            suspicious.classes.add(name);
            return;
        }

        // any function/method parameter - a plain identifier directly in the params list
        // (destructured/rest/default params aren't flagged here, just the simple case)
        if (t.isFunction(parent) && path.listKey === 'params') {
            suspicious.parameters.add(name);
            return;
        }

        if (path.node.start && path.node.start < shadowGenPos) return;

        if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
            const isCommCodeThingy = path.findParent(p =>
                t.isVariableDeclarator(p.node) &&
                t.isIdentifier(p.node.id) &&
                p.node.id.name === 'CommCode'
            );

            if (!isCommCodeThingy && !isHome) suspicious.properties.add(name);
            return;
        }

        if (t.isClassMethod(parent) && parent.key === path.node && !parent.computed) {
            if (!isHome) suspicious.properties.add(name);
            return;
        }

        if (t.isClassProperty(parent) && parent.key === path.node && !parent.computed) {
            if (!isHome) suspicious.properties.add(name);
            return;
        }

        if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === path.node && !parent.computed) {
            const grandParent = path.parentPath.parent;
            if (t.isAssignmentExpression(grandParent) && t.isStringLiteral(grandParent.right) && grandParent.right.value === path.node.name) return;
            if (t.isAssignmentExpression(grandParent) && t.isNumericLiteral(grandParent.right)) return;
            if (!isHome) suspicious.properties.add(name);
            return;
        }
    },
    FunctionDeclaration(path) {
        if (path.node.id && isObfuscated(path.node.id.name)) suspicious.functions.add(path.node.id.name);
    }
});

const ssJS = [
    'e', 't', 'i', 'n', 'a', 's', 'r', 'o', 'l', 'c', 'h', 'f', 'u', 'm', 'd', 'p', '_', 'v', 'g', 'y',
    'S', 'E', 'A', 'C', 'R', 'T', 'N', 'M', 'I', 'x', 'b', 'P', 'w', 'O', 'D', 'L', 'F', 'k', 'B', 'G',
    'U', 'H', 'V', 'W', 'z', 'X', 'Y', 'j', 'K', '$', 'q', 'J', 'Q', 'Z',
    'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', '_x', '_y', '_z',
    'dx', 'dy', 'dz', 'hp', 'id', 'ip', 'ok', 'on', 'rx', 'ry', 'rz',
    'ui', 'PI', 'bb' /* bb = bounding box */, 'ga', 'up', 'ws', 'to'
]

const home = [
    'ad', 'cx', 'cy', 'dx', 'dy', 'ga', 'id', 'ok', 'on',
    'no', 'ps', /* playstation */ 'rx', 'ry', 'ui', 'up'
]

const known = new Set(isHome ? home : ssJS);

for (const [category, names] of Object.entries(suspicious)) {
    const filtered = [...names].filter(n => !known.has(n)).sort();
    if (filtered.length === 0) continue;
    console.log(`\n[${category}] ${filtered.length} suspicious names:`);
    for (const name of filtered) console.log(`  ${name}`);
}