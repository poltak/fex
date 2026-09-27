import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const root = path.resolve('dist');
const viteManifest = JSON.parse(await readFile(path.join(root, '.vite/manifest.json'), 'utf8'));
const worker = await readFile(path.join(root, 'sw.js'), 'utf8');
function readPrecacheEntries(source) {
  const declarations = source.matchAll(/(?:var|let|const)\s+[$\w]+\s*=\s*/g);
  for (const declaration of declarations) {
    const start = declaration.index + declaration[0].length;
    if (source[start] !== '[') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index++) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '[') depth++;
      else if (character === ']' && --depth === 0) {
        try {
          const entries = JSON.parse(source.slice(start, index + 1));
          if (Array.isArray(entries) && entries.length && entries.every(entry => entry && typeof entry.url === 'string' && Object.hasOwn(entry, 'revision'))) return entries;
        } catch { /* Continue until the injected Workbox array is found. */ }
        break;
      }
    }
  }
  throw new Error('Could not read the Workbox precache list from dist/sw.js.');
}

const precacheEntries = readPrecacheEntries(worker);
if (precacheEntries.some(entry => typeof entry.url !== 'string')) {
  throw new Error('The Workbox precache list is empty or invalid.');
}

async function outputFile(url) {
  const pathname = decodeURIComponent(new URL(url, 'https://fex.invalid').pathname);
  const segments = pathname.split('/').filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    const relative = segments.slice(index).join(path.sep);
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(`${root}${path.sep}`)) continue;
    try {
      if ((await stat(candidate)).isFile()) return path.relative(root, candidate);
    } catch { /* Try the next suffix for base-prefixed manifest URLs. */ }
  }
  throw new Error(`Precached file is missing from dist: ${url}`);
}

const precachedFiles = new Set(await Promise.all(precacheEntries.map(entry => outputFile(entry.url))));
const initialFiles = new Set(['index.html']);
const initialScripts = new Set();
const visited = new Set();
const entryKey = Object.keys(viteManifest).find(key => viteManifest[key].isEntry && (key === 'index.html' || viteManifest[key].src === 'index.html'));
if (!entryKey) throw new Error('The Vite manifest has no index.html entry.');

function visitStaticImport(key) {
  if (visited.has(key)) return;
  const entry = viteManifest[key];
  if (!entry) throw new Error(`Static import is missing from the Vite manifest: ${key}`);
  visited.add(key);
  if (entry.file) {
    initialFiles.add(entry.file);
    if (entry.file.endsWith('.js')) initialScripts.add(entry.file);
  }
  for (const file of [...(entry.css || []), ...(entry.assets || [])]) initialFiles.add(file);
  for (const imported of entry.imports || []) visitStaticImport(imported);
}
visitStaticImport(entryKey);

async function gzipSize(relative) {
  return gzipSync(await readFile(path.join(root, relative))).length;
}
async function totalSize(files) {
  const sizes = await Promise.all([...files].map(gzipSize));
  return sizes.reduce((sum, size) => sum + size, 0);
}

const initialJavaScriptBytes = await totalSize(initialScripts);
const initialPageBytes = await totalSize(initialFiles);
const precacheBytes = await totalSize(precachedFiles);
const serviceWorkerBytes = gzipSync(Buffer.from(worker)).length;
const installationBytes = precacheBytes + serviceWorkerBytes;

console.log(`Initial static JavaScript: ${(initialJavaScriptBytes / 1024).toFixed(2)} KiB gzip / 25 KiB`);
console.log(`Initial page resources: ${(initialPageBytes / 1024).toFixed(2)} KiB gzip`);
console.log(`Unique precached assets: ${precachedFiles.size} files, ${(precacheBytes / 1024).toFixed(2)} KiB gzip`);
console.log(`Service worker: ${(serviceWorkerBytes / 1024).toFixed(2)} KiB gzip`);
console.log(`Complete offline installation: ${(installationBytes / 1024).toFixed(2)} KiB gzip / 75 KiB`);
if (initialJavaScriptBytes > 25 * 1024 || installationBytes > 75 * 1024) process.exitCode = 1;
