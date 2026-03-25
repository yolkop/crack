const cleanup = (js: string) => {
    js = js.replace(/\.pnpm\/@([A-Za-z]+)\+([A-Za-z]+)@[0-9]+\.[0-9]+\.[0-9]+\/node_modules\//g, '');

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
        js = js.replace(regex, '');
    });

    return js;
}

export default cleanup;