import fs from 'node:fs';
import path from 'node:path';

const pullFile = async (p: string) => {
    const filePath = path.resolve(p);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return fs.readFileSync(filePath, 'utf8');
    else {
        const req = await fetch(p);
        if (!req.ok) throw new Error(`failed to find ${p} on local FS or web`);
        return await req.text();
    }
}

export default pullFile;