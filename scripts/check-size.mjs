import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const root = path.resolve('dist');
const manifest = JSON.parse(await readFile(path.join(root, '.vite/manifest.json'), 'utf8'));
const initial = new Set(['index.html']);
const scripts = new Set();
const visit = key => {
  const entry = manifest[key];
  if (!entry || scripts.has(entry.file)) return;
  scripts.add(entry.file); initial.add(entry.file);
  for (const file of [...(entry.css || []), ...(entry.assets || [])]) initial.add(file);
  for (const imported of entry.imports || []) visit(imported);
};
Object.keys(manifest).filter(key => manifest[key].isEntry).forEach(visit);
// Count the complete local badge set and favicon, even when the first screen uses fewer.
for (const file of await readdir(path.join(root, 'badges'))) initial.add(`badges/${file}`);
initial.add('favicon.svg');
initial.add('manifest.webmanifest');
const sizes = new Map();
for (const file of initial) sizes.set(file, gzipSync(await readFile(path.join(root, file))).length);
const js = [...scripts].reduce((sum, file) => sum + sizes.get(file), 0);
const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
const sw = gzipSync(await readFile(path.join(root, 'sw.js'))).length;
// Installation starts during the first visit. Include its extra icon downloads.
let installed = total + sw;
for (const file of await readdir(path.join(root, 'icons'))) installed += gzipSync(await readFile(path.join(root, 'icons', file))).length;
console.log(`Initial JavaScript: ${(js / 1024).toFixed(2)} KiB gzip / 25 KiB`);
console.log(`Initial page resources: ${(total / 1024).toFixed(2)} KiB gzip`);
console.log(`Service worker (separate): ${(sw / 1024).toFixed(2)} KiB gzip`);
console.log(`Page plus offline installation: ${(installed / 1024).toFixed(2)} KiB gzip / 75 KiB`);
if (js > 25 * 1024 || installed > 75 * 1024) process.exitCode = 1;
