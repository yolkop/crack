import fs from 'node:fs';
import path from 'node:path';

const pullFile = async (p: string) => {
    if (p.startsWith('/') || p.startsWith('./') || p.startsWith('../')) {
        const filePath = path.resolve(p);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return fs.readFileSync(filePath, 'utf8');
        else throw new Error(`file not found on local FS: ${p}`);
    } else {
        const req = await fetch(p);
        if (!req.ok) throw new Error(`failed to fetch ${p}: ${req.status} ${req.statusText}`);
        return await req.text();
    }
}

export default pullFile;