import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

export async function createPwaServer({ base }) {
  const temp = await mkdtemp(path.join(tmpdir(), 'fex-pwa-test-'));
  const directories = { A: path.join(temp, 'A'), B: path.join(temp, 'B') };
  try {
    for (const [version, directory] of Object.entries(directories)) {
      await exec(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', directory], {
        cwd: process.cwd(), env: { ...process.env, FEX_BASE_PATH: base, FEX_BUILD_ID: `browser-${version}` },
      });
    }
  } catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
  let version = 'A';
  const headers = Object.fromEntries((await readFile('public/_headers', 'utf8')).split('\n\n')[0].split('\n').slice(1).map(line => {
    const colon = line.indexOf(':'); return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }));
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith(base)) { response.writeHead(404); response.end('Outside Fex'); return; }
    const relative = decodeURIComponent(pathname.slice(base.length)) || 'index.html';
    const file = path.resolve(directories[version], relative);
    if (!file.startsWith(directories[version] + path.sep)) { response.writeHead(404); response.end(); return; }
    try {
      const content = await readFile(file);
      response.writeHead(200, { ...headers, 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', Vary: 'Origin' });
      response.end(content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, url: origin + base,
    useVersion(value) { version = value; },
    async close() { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); },
  };
}
