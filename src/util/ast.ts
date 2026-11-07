import traverse, { type Binding, type NodePath, type Scope } from '@babel/traverse';
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

export const walkAst = (root: t.Node, enter: (node: t.Node, parent: t.Node | null) => void, exit?: (node: t.Node) => void) => {
    const walk = (node: t.Node, parent: t.Node | null) => {
        enter(node, parent);

        const keys = t.VISITOR_KEYS[node.type];
        if (keys) for (const key of keys) {
            const child = (node as any)[key];

            if (Array.isArray(child)) {
                for (const item of child) if (item) walk(item, node);
            } else if (child) walk(child, node);
        }

        if (exit) exit(node);
    };

    walk(root, null);
};

export const visitAst = (root: t.Node, visitors: Record<string, (path: { node: any; parent: any }) => void>) => {
    const shim = { node: null as any, parent: null as any };

    walkAst(root, (node, parent) => {
        const visitor = visitors[node.type];
        if (!visitor) return;

        shim.node = node;
        shim.parent = parent;
        visitor(shim);
    });
};

export const visitAstScoped = (root: t.Node, visitors: Record<string, (path: { node: any; parent: any; scope: Scope | undefined }) => void>) => {
    const stack: t.Node[] = [];
    const scopeCache = (traverse as any).cache.scope as WeakMap<t.Node, Scope>;

    const shim = {
        node: null as any,
        parent: null as any,
        get scope(): Scope | undefined {
            for (let i = stack.length - 1; i >= 0; i--) {
                const scope = scopeCache.get(stack[i]);
                if (scope && scope.block === stack[i]) return scope;
            }

            return undefined;
        }
    };

    walkAst(root, (node, parent) => {
        stack.push(node);

        const visitor = visitors[node.type];
        if (!visitor) return;

        shim.node = node;
        shim.parent = parent;
        visitor(shim);
    }, () => {
        stack.pop();
    });
};

export const getObjectKeys =(node: t.ObjectExpression): string[] => node.properties
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

// renames a function/constructor's params (and every reference to them within its
// own scope) to the given clean names, matched up positionally. only touches plain
// identifier params - destructured/rest/default params are left alone.
export const renameParamsByPosition = (fnPath: NodePath<t.Function>, newNames: string[]) => {
    fnPath.node.params.forEach((param, i) => {
        const newName = newNames[i];
        if (!newName || !t.isIdentifier(param)) return;

        const oldName = param.name;
        if (oldName === newName) return;

        try {
            fnPath.scope.rename(oldName, newName);
        } catch (e) {
            console.warn(`failed to rename param ${oldName} -> ${newName}:`, e);
        }
    });
};

const collectBindingIdentifiers = (binding: Binding): Set<t.Identifier> => {
    const oldName = binding.identifier.name;
    const ids = new Set<t.Identifier>([binding.identifier]);

    for (const ref of binding.referencePaths) {
        if (!t.isIdentifier(ref.node) || ref.node.name !== oldName) continue;

        ids.add(ref.node);
        if (t.isObjectProperty(ref.parent) && ref.parent.shorthand && ref.parent.value === ref.node) ref.parent.shorthand = false;
    }

    for (const violation of binding.constantViolations)
        for (const id of Object.values(t.getBindingIdentifiers(violation.node, false, false, false)).flat())
            if (id.name === oldName) ids.add(id);

    return ids;
};

export const applyBindingRenames = (items: { binding: Binding; newName: string }[]) => {
    const prepared = items.map(({ binding, newName }) => ({ binding, newName, oldName: binding.identifier.name, ids: collectBindingIdentifiers(binding) }));

    for (const { binding, oldName } of prepared)
        if (binding.scope.bindings[oldName] === binding) binding.scope.removeOwnBinding(oldName);

    for (const { binding, newName, ids } of prepared) {
        for (const id of ids) id.name = newName;
        binding.scope.bindings[newName] = binding;
    }
};