
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
    7. profit

    INJECTION INSTRUCTIONS:
    1. do the above usage instructions 1-4
    2. save the shellshock.js file to `in/prod.js`
    3. do the above usage instructions 6-7
    4. import http://localhost:6056/script.user.js into your userscript manager
    5. load up the game on its main url
    6. profit

    ---

    made with ❤️