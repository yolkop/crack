import { workerData, parentPort } from 'worker_threads';

import { execFirst } from '../../util/fastRegex';

const { sab, chunk } = workerData as {
    sab: SharedArrayBuffer;
    chunk: Array<{
        kind: 'variable' | 'function' | 'prop';
        name: string;
        regex?: string;
        hasCode?: string;
        after?: boolean;
    }>;
};

const src = new TextDecoder().decode(new Uint8Array(sab));

const results: {
    variableRenames: Record<string, string>;
    functionRenames: Record<string, string>;
    propertyRenames: Record<string, string>;
} = {
    variableRenames: {},
    functionRenames: {},
    propertyRenames: {},
};

for (const pattern of chunk) {
    if (!pattern.regex) continue;

    const match = execFirst(src, pattern.regex);
    if (!match?.[1]) continue;

    const captured = match[1];

    switch (pattern.kind) {
        case 'variable':
            results.variableRenames[captured] = pattern.name;
            break;

        case 'function':
            results.functionRenames[captured] = pattern.name;
            break;

        case 'prop':
            results.propertyRenames[captured] = pattern.name;
            break;
    }
}

parentPort!.postMessage(results);