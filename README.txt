
    >>>>>>>   <<<<<<<
    >>> yolkcrack <<<
    >>>>>>>   <<<<<<<

    This repository contains only pattern-matching tools developed through 
    independent reverse engineering. It does not contain, reproduce, or 
    distribute any game source code, compiled binaries, or proprietary assets.

    The mappings in `src/mappings.ts` consist of regular expressions that 
    identify structural patterns in minified JavaScript. They were written 
    from scratch and do not reproduce any copyrighted code.

    This repository cannot, by itself, be used to obtain or redistribute 
    the source code of any software.

    ---

    SETUP INSTRUCTIONS:
    1. install Bun
    2. `bun install`

    USAGE INSTRUCTIONS:
    1. obtain a JS file to remap
    2. run said JS file through webcrack (https://webcrack.netlify.app)
    3. obtain a commcode file (formatted https://x.yolkbot.xyz/data/comm/nameToVar.json)
    4. save files from steps 2 and 3 to the filesystem or have a URL ready
    5. `bun . {path or link to JS file} {path or link to commcode file}
    6. wait like 2 minutes
    7. observe out dir

    ---

    made with ❤️