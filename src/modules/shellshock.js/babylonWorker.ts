import { workerData, parentPort } from 'worker_threads';

const src = new TextDecoder().decode(new Uint8Array((workerData as { sab: SharedArrayBuffer }).sab));

const assignToObjectRegex = /([A-z0-9$_]+)\([A-z0-9$_]+, \{\s*bonesDeclaration(?:WGSL)?:/;
const assignToObject = src.match(assignToObjectRegex)?.[1];

const shaderAccessorRegex = new RegExp(`var ([A-z0-9$_]+) = \\{\\};\\s*${assignToObject}\\(([A-z0-9$_]+), \\{\\s*([A-z0-9$_]+): \\(\\) \\=> ([A-z0-9$_]+)`, 'g');
const shaderAccessor = Array.from(src.matchAll(shaderAccessorRegex), m => Array.from(m));

const createShaderRegex = /([A-z0-9$_]+)\(\{\s*"..\/node_modules\/@babylonjs\/core\/Shaders\/ShadersInclude/;
const createShader = src.match(createShaderRegex)?.[1];

const ensureShaderStoreRegex = /postprocess\.vertex\.js"\(\) \{\s*([A-z0-9$_]+)\(\);/;
const ensureShaderStore = src.match(ensureShaderStoreRegex)?.[1];

const shaderFactoryRegex = new RegExp(`var ([A-z0-9$_]+) = ${createShader}\\(\\{\\s*"[^"]+"\\(\\) \\{\\s*${ensureShaderStore}\\(\\);\\s*(?:[A-z0-9$_]+\\(\\);\\s*)*([A-z0-9$_]+) = "([A-z0-9$_]+)";\\s*([A-z0-9$_]+) = "`, 'g');
const shaderFactory = Array.from(src.matchAll(shaderFactoryRegex), m => Array.from(m));

const shaderIncludeRegex = new RegExp(`var ([A-z0-9$_]+) = ${createShader}\\(\\{\\s*"[^"]+"\\(\\) \\{\\s*${ensureShaderStore}\\(\\);\\s*(?:(?:[A-z0-9$_]+\\(\\);|"[^"]*";)\\s*)*[A-z0-9$_]+\\.IncludesShadersStore(?:WGSL)?\\.([A-z0-9$_]+) = "`, 'g');
const shaderInclude = Array.from(src.matchAll(shaderIncludeRegex), m => Array.from(m));

const wgslStubRegex = /var ([A-z0-9$_]+) = \{\};\s*var ([A-z0-9$_]+) = [A-z0-9$_]+\(\{\s*"wgsl-stub:[^"]+\/ShadersWGSL\/([^"]+).js"\(\) \{\}\s*\}\);/g;
const wgslStub = Array.from(src.matchAll(wgslStubRegex), m => Array.from(m));

parentPort!.postMessage({ createShader, ensureShaderStore, shaderAccessor, shaderFactory, shaderInclude, wgslStub });
