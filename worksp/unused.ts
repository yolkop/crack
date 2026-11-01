import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import fs from 'node:fs';

import mappings from '../src/modules/shellshock.js/mappings';

const input = fs.readFileSync(process.argv[2], 'utf-8');

const ast = parser.parse(input, { sourceType: 'module' });

const usedNames = new Set<string>();

traverse(ast, {
    Identifier(path) {
        usedNames.add(path.node.name);
    },
    StringLiteral(path) {
        usedNames.add(path.node.value);
    }
});

const categories: Record<string, string[]> = {
    classes: mappings.classes.map(m => m.name),
    functions: mappings.functions.map(m => m.name),
    objects: mappings.objects.map(m => m.name),
    constants: mappings.constants.map(m => m.name),
    variables: mappings.variables.map(m => m.name),
    props: mappings.props.map(m => m.name),
    commSwitch: mappings.commSwitch.map(m => m.name)
};

let anyUnused = false;

for (const [category, names] of Object.entries(categories)) {
    const uniqueNames = [...new Set(names)];
    const unused = uniqueNames.filter(name => !usedNames.has(name));

    if (unused.length === 0) continue;

    anyUnused = true;

    console.log(`[${category}] ${unused.length} unused item${unused.length === 1 ? '' : 's'}:`);
    for (const name of unused) console.log(`  ${name}`);
    console.log('');
}

if (!anyUnused) console.log('no unused mappings found');