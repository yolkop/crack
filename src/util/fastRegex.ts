const IDENT_GROUP = /^\(\[(?:A-Za-z0-9|A-z0-9)\$_\]\+\)/;
const SIMPLE_CLASS = /^\[[A-Za-z0-9$_\- ]+\]/;
const ESCAPABLE = '()[]{}.*+?|$^/-"\'=,:;<>!@#%&~`_ ';
const META = '^$.|?*+()[]{}';
const WINDOW = 400;
const MIN_ANCHOR = 3;

const anchorCache = new Map<string, string | null>();

const hasAlternation = (source: string): boolean => {
    let inClass = false;

    for (let i = 0; i < source.length; i++) {
        const char = source[i];

        if (char === '\\') i++;
        else if (inClass) inClass = char !== ']';
        else if (char === '[') inClass = true;
        else if (char === '|') return true;
    }

    return false;
};

export const getAnchor = (source: string): string | null => {
    const cached = anchorCache.get(source);
    if (cached !== undefined) return cached;

    let best = '';
    let run = '';
    let i = 0;

    const endRun = () => {
        if (run.length > best.length) best = run;
        run = '';
    };

    if (!hasAlternation(source)) scan: while (i < source.length) {
        const char = source[i];
        const following = source[i + 1] ?? '';

        if (char === '(') {
            const group = IDENT_GROUP.exec(source.slice(i));
            if (!group) break;

            endRun();
            i += group[0].length;
            continue;
        }

        if (char === '[') {
            const cls = SIMPLE_CLASS.exec(source.slice(i));
            if (!cls) break;

            endRun();
            i += cls[0].length;

            const quantifier = source[i] ?? '';
            if (quantifier === '+' || quantifier === '?' || quantifier === '*') i++;
            else if (quantifier === '{') break scan;
            continue;
        }

        if (char === '\\') {
            if (ESCAPABLE.includes(following) && following !== '') {
                if ('?*+{'.includes(source[i + 2] ?? '')) {
                    endRun();
                    break;
                }

                run += following;
                i += 2;
                continue;
            }

            if (following === 's' && '*+?'.includes(source[i + 2] ?? '')) {
                endRun();
                i += 3;
                continue;
            }

            break;
        }

        if (char === '.') {
            if ('*+?{'.includes(following)) break;

            endRun();
            i++;
            continue;
        }

        if (META.includes(char)) break;

        if ('*+{'.includes(following) && following !== '') {
            endRun();
            break;
        }

        if (following === '?') {
            endRun();
            i += 2;
            continue;
        }

        run += char;
        i++;
    }

    endRun();

    const anchor = best.length >= MIN_ANCHOR ? best : null;
    anchorCache.set(source, anchor);
    return anchor;
};

export const execFirst = (text: string, source: string): RegExpExecArray | null => {
    const regex = new RegExp(source, 'g');
    const anchor = getAnchor(source);

    if (anchor !== null) {
        const position = text.indexOf(anchor);
        if (position === -1) return null;

        regex.lastIndex = Math.max(0, position - WINDOW);
    }

    return regex.exec(text);
};
