import path from 'node:path';

Bun.serve({
    port: 4494,
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/script.user.js') return new Response(
            Bun.file(path.join(import.meta.dirname, 'userscript.js')),
            { headers: { 'Content-Type': 'application/javascript' } }
        );

        let content = await Bun.file(path.resolve(process.argv[2])).text();

        if (content.endsWith('\n')) content = content.slice(0, -1);
        content = content.split('\n').slice(1, -1).join('\n');

        return new Response(content, { headers: { 'Content-Type': 'application/javascript' } });
    }
});

console.log('-- injector is running! follow readme 4 setup');
console.log('-- http://localhost:4494/script.user.js');