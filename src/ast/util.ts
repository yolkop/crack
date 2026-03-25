import * as t from '@babel/types';

export const sortClassMembers = (classBody: t.ClassBody): void => {
    const constructor = classBody.body.find(item => t.isClassMethod(item) &&
        item.kind === 'constructor' &&
        (!item.key || !t.isIdentifier(item.key) || item.key.name === 'constructor'));

    const getters = classBody.body.filter(item => t.isClassMethod(item) && item.kind === 'get');
    const setters = classBody.body.filter(item => t.isClassMethod(item) && item.kind === 'set');

    const methods = classBody.body.filter(item => !t.isClassMethod(item) ||
        (item.kind !== 'constructor' && item.kind !== 'get' && item.kind !== 'set'));

    // prop names -> getter/setter pairs
    const accessorPairs: { [key: string]: { getter?: any; setter?: any } } = {};

    getters.forEach(getter => {
        if ('key' in getter && t.isIdentifier(getter.key)) {
            const name = getter.key.name;
            if (!accessorPairs[name]) accessorPairs[name] = {};
            accessorPairs[name].getter = getter;
        }
    });

    setters.forEach(setter => {
        if ('key' in setter && t.isIdentifier(setter.key)) {
            const name = setter.key.name;
            if (!accessorPairs[name]) accessorPairs[name] = {};
            accessorPairs[name].setter = setter;
        }
    });

    const sortedPropNames = Object.keys(accessorPairs).sort();

    // getters first, then setters
    const orderedAccessors: (t.ClassMethod | t.ClassProperty)[] = [];
    for (const propName of sortedPropNames) {
        const pair = accessorPairs[propName];
        if (pair.getter) orderedAccessors.push(pair.getter);
        if (pair.setter) orderedAccessors.push(pair.setter);
    }

    // the rest of the methods
    methods.sort((a, b) => {
        const aName = t.isClassMethod(a) && t.isIdentifier(a.key) ? a.key.name : t.isClassProperty(a) && t.isIdentifier(a.key) ? a.key.name : '';
        const bName = t.isClassMethod(b) && t.isIdentifier(b.key) ? b.key.name : t.isClassProperty(b) && t.isIdentifier(b.key) ? b.key.name : '';

        return aName.localeCompare(bName);
    });

    // constructor first, then accessors, then other methods
    classBody.body = constructor
        ? [constructor, ...orderedAccessors, ...methods]
        : [...orderedAccessors, ...methods];
};

export const getClassProperties = (classBody: t.ClassBody): string[] => {
    const props: string[] = [];

    for (const item of classBody.body) {
        if (t.isClassMethod(item) && t.isIdentifier(item.key)) props.push(item.key.name);
        else if (t.isClassProperty(item) && t.isIdentifier(item.key)) props.push(item.key.name);
    }

    return props;
}

export const getObjectKeys = (node: t.ObjectExpression): string[] => node.properties
    .filter(p => t.isObjectProperty(p) && t.isIdentifier(p.key))
    .map(p => (p as t.ObjectProperty).key)
    .filter(k => t.isIdentifier(k))
    .map(k => (k as t.Identifier).name);

export const checkArrayOfObjects = (node: t.ArrayExpression, requiredProps: string[]): boolean => {
    const samples = node.elements.slice(0, 3).filter(e => e && t.isObjectExpression(e));
    if (samples.length === 0) return false;

    for (const sample of samples) {
        if (!t.isObjectExpression(sample)) continue;

        const keys = getObjectKeys(sample);
        const hasAllProps = requiredProps.every(prop => keys.includes(prop));

        if (!hasAllProps) return false;
    }

    return true;
}

export interface IdentifierMapping {
    [key: string]: string;
}

export const addMapping = (map: IdentifierMapping, oldName: string, newName: string) => {
    if (!oldName || !newName || typeof oldName !== 'string' || typeof newName !== 'string')
        return console.warn(`Invalid mapping: ${oldName} -> ${newName}`);

    if (map[oldName] && map[oldName] !== newName)
        return console.warn(`conflicting mapping for ${oldName}: ${map[oldName]} vs ${newName}`);

    map[oldName] = newName;
}