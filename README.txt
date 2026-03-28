
    >>>>>>>   <<<<<<<
    >>> yolkcrack <<<
    >>>>>>>   <<<<<<<

    This repository contains only pattern-matching tools developed through 
    independent reverse engineering. It does not contain, reproduce, or 
    distribute any game source code, compiled binaries, or proprietary assets.

    The mappings in `src/mappings.ts` consist of regular expressions that 
    identify structural patterns in minified JavaScript. They were written 
    from scratch and do not contain or reproduce any copyrighted code.

    This repository cannot, by itself, be used to obtain or redistribute 
    the source code of any software.

    ---

    SETUP INSTRUCTIONS:
    1. install Bun
    2. `bun install`

    USAGE INSTRUCTIONS:
    1. obtain a JS file
    2. prepare the JS file for remapping (bun process <filepath>)
    3. run the output through webcrack (https://webcrack.netlify.app)
    4. obtain a commcode file (formatted https://x.yolkbot.xyz/data/comm/nameToVar.json)
    5. save files from steps 3 and 4 to the filesystem or have a URL ready
    6. `bun . {path or link to JS file} {path or link to commcode file}
    7. wait like 2 minutes
    8. observe out dir

    ---

    made with ❤️