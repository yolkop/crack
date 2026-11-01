
    >>>>>>>   <<<<<<<
    >>> yolkcrack <<<
    >>>>>>>   <<<<<<<

    This repository contains only pattern-matching tools developed through 
    independent reverse engineering. It does not contain, reproduce, or 
    distribute any proprietary source code, compiled binaries, or assets.

    The mappings throughout the repository consist of regular expressions that 
    identify structural patterns in minified JavaScript. They were written 
    from scratch and do not contain or reproduce any proprietary material.

    This repository cannot, by itself, be used to obtain or redistribute 
    the source code of any proprietary software.

    ---

    ai disclosure: this repository was handwritten in early 2026. maintenance
    of this form of tool is very time consuming, so it was handed off to claude
    for maintenance in August. all of the home module was written by claude a
    my direction, as well as the modern parts of shellshock.js. 

    ---

    SETUP INSTRUCTIONS:
    1. install Bun
    2. `bun install`

    SHELLSHOCK.JS USAGE INSTRUCTIONS:
    1. obtain the JS file
    2. prepare the JS file for remapping (bun process <filepath>)
    3. run the output through webcrack (https://webcrack.netlify.app)
    4. obtain a commcode file (formatted https://x.yolkbot.xyz/comm/nameToVar.json)
    5. save files from steps 3 and 4 to the filesystem or have a URL ready
    6. `bun . {path or link to JS file} {path or link to commcode file}
    7. wait 10 seconds
    8. observe out dir
    9. profit

    HOME.JS USAGE INSTRUCTIONS:
    1. obtain the JS file
    2. run the JS file through webcrack (https://webcrack.netlify.app)
    3. save the file from step 2 to the filesystem or have a URL ready
    4. `bun . {path or link to JS file}`
    5. wait 10 seconds
    6. observe out dir
    7. profit

    ---

    made with ❤️
