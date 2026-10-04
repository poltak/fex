import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

// Compare the build in dist/ with the two size limits from APP_PLAN.md.
const INITIAL_SCRIPT_LIMIT = 25 * 1024;
const INSTALLATION_LIMIT = 75 * 1024;
const root = path.resolve('dist');
const kib = bytes => (bytes / 1024).toFixed(2);

async function gzipSize(files) {
  const sizes = await Promise.all([...files].map(async file => gzipSync(await readFile(path.join(root, file))).length));
  return sizes.reduce((sum, size) => sum + size, 0);
}

// The build puts the precache list in the worker as a JSON array. Its URLs are relative to dist/.
const worker = await readFile(path.join(root, 'sw.js'), 'utf8');
const list = worker.match(/\[\{"revision":.*?\}\]/s);
if (!list) throw new Error('Could not read the precache list from dist/sw.js.');
const precached = new Set(JSON.parse(list[0]).map(entry => entry.url));

// The first screen loads the page, its entry script, and that script's static imports. The chart loads later.
const manifest = JSON.parse(await readFile(path.join(root, '.vite/manifest.json'), 'utf8'));
const initialFiles = new Set(['index.html']);
function addStaticImports(key) {
  const entry = manifest[key];
  if (!entry) throw new Error(`Static import is missing from the Vite manifest: ${key}`);
  if (initialFiles.has(entry.file)) return;
  for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) initialFiles.add(file);
  for (const imported of entry.imports || []) addStaticImports(imported);
}
addStaticImports('index.html');

const initialScriptBytes = await gzipSize([...initialFiles].filter(file => file.endsWith('.js')));
const installationBytes = await gzipSize(precached) + gzipSync(worker).length;

console.log(`Initial static JavaScript: ${kib(initialScriptBytes)} KiB gzip / ${kib(INITIAL_SCRIPT_LIMIT)} KiB`);
console.log(`Initial page resources: ${kib(await gzipSize(initialFiles))} KiB gzip`);
console.log(`Complete offline installation: ${precached.size} files and the worker, ${kib(installationBytes)} KiB gzip / ${kib(INSTALLATION_LIMIT)} KiB`);
if (initialScriptBytes > INITIAL_SCRIPT_LIMIT || installationBytes > INSTALLATION_LIMIT) process.exitCode = 1;
