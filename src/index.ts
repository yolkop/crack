if (!process.argv[3]) {
    console.log('usage: bun . <JS file> <comm data>');
    process.exit(1);
}

console.log('[init] runtime has init');

const start = Date.now();

import fs from 'node:fs';
import path from 'node:path';

import remap from './ast/build';
import mappings from './mappings';
import pullFile from './pull';

const js: string = await pullFile(process.argv[2]);
const remapResult = remap(js);

const types = [
    mappings.classes,
    mappings.constants,
    mappings.functions,
    mappings.objects,
    mappings.variables,
    mappings.props
]

if (process.argv[4]) types.forEach((type) => type.forEach((item) => {
    const name = item.name;
    if (!remapResult.includes(name)) {
        console.log('well well WELL. it appears something you did doesnt work :<');
        console.log(item);
    }
}))

const outDir = path.join(import.meta.dirname, '..', 'out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
fs.writeFileSync(path.join(outDir, path.basename(process.argv[2])), remapResult);

console.log('completed in', ((Date.now() - start) / 1000).toFixed(3) + 's')