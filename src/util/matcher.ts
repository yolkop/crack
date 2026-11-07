export const createFirstMatcher = (patterns: string[]): ((text: string) => number) => {
    let alwaysIdx = Infinity;
    const nonEmpty: [string, number][] = [];

    patterns.forEach((pattern, idx) => {
        if (pattern === '') alwaysIdx = Math.min(alwaysIdx, idx);
        else nonEmpty.push([pattern, idx]);
    });

    const isAscii = nonEmpty.every(([pattern]) => {
        for (let i = 0; i < pattern.length; i++) if (pattern.charCodeAt(i) >= 128) return false;
        return true;
    });

    if (!isAscii) return text => {
        let best = alwaysIdx;
        for (const [pattern, idx] of nonEmpty) if (idx < best && text.includes(pattern)) best = idx;
        return best === Infinity ? -1 : best;
    };

    let stateCount = 1;
    for (const [pattern] of nonEmpty) stateCount += pattern.length;

    const next = new Int32Array(stateCount * 128).fill(-1);
    const out = new Int32Array(stateCount).fill(0x7fffffff);
    const fail = new Int32Array(stateCount);

    let used = 1;

    for (const [pattern, idx] of nonEmpty) {
        let state = 0;

        for (let i = 0; i < pattern.length; i++) {
            const slot = state * 128 + pattern.charCodeAt(i);
            if (next[slot] === -1) next[slot] = used++;
            state = next[slot];
        }

        if (idx < out[state]) out[state] = idx;
    }

    const queue: number[] = [];

    for (let c = 0; c < 128; c++) {
        const child = next[c];

        if (child === -1) next[c] = 0;
        else {
            fail[child] = 0;
            queue.push(child);
        }
    }

    for (let head = 0; head < queue.length; head++) {
        const state = queue[head];
        if (out[fail[state]] < out[state]) out[state] = out[fail[state]];

        for (let c = 0; c < 128; c++) {
            const slot = state * 128 + c;
            const child = next[slot];

            if (child === -1) next[slot] = next[fail[state] * 128 + c];
            else {
                fail[child] = next[fail[state] * 128 + c];
                queue.push(child);
            }
        }
    }

    return text => {
        let best = alwaysIdx;
        let state = 0;

        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            state = code < 128 ? next[state * 128 + code] : 0;

            const hit = out[state];
            if (hit < best) {
                best = hit;
                if (best === 0) break;
            }
        }

        return best === Infinity || best === 0x7fffffff ? -1 : best;
    };
};
