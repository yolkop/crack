if (!process.argv[2]) {
    console.log('usage: bun . <JS file>');
    process.exit(1);
}

console.log('[init] runtime has init');

const start = Date.now();

import fs from 'node:fs';
import path from 'node:path';

import pullFile from './util/pullFile';

import remapHomeJS from './modules/home.js/build';
import remapSSJS from './modules/shellshock.js/build';

const MATCHING = {
    '!u57': remapSSJS,
    'createElementVNode': remapHomeJS
} as const;

const js: string = await pullFile(process.argv[2]);

const mappingKey = Object.keys(MATCHING).find(key => js.includes(key)) as keyof typeof MATCHING | undefined;
const mapFunc = mappingKey ? MATCHING[mappingKey] : null;

if (!mapFunc) {
    console.log('no mapping found for', process.argv[2]);
    process.exit(1);
}

if (mapFunc === remapSSJS && !process.argv[3]) {
    console.log('usage: bun . <JS file> <comm data>');
    process.exit(1);
}

const remapResult = await mapFunc(js);

const outDir = path.join(import.meta.dirname, '..', 'out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
fs.writeFileSync(path.join(outDir, path.basename(process.argv[2])), remapResult);

console.log('completed in', ((Date.now() - start) / 1000).toFixed(3) + 's')