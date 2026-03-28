if (!fs.existsSync(process.argv[2])) {
    console.error('file not found: ' + process.argv[2]);
    process.exit(1);
}

import fs from 'node:fs';
import path from 'node:path';

import { processJS } from 'yolkbot/wasm';

console.log('processing file: ' + process.argv[2]);

const processed = processJS(fs.readFileSync(process.argv[2], 'utf8'));

const outPath = path.join(import.meta.dirname, 'out');
if (!fs.existsSync(outPath)) fs.mkdirSync(outPath);

const fileName = path.basename(process.argv[2]);
fs.writeFileSync(path.join(outPath, `out_${fileName}`), processed);
console.log('output saved to: ' + path.join(outPath, `out_${fileName}`));