import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const rawBase = process.env.FEX_BASE_PATH || '/';
const base = `/${rawBase.split('/').filter(Boolean).join('/')}${rawBase === '/' ? '' : '/'}`;
const buildId = process.env.FEX_BUILD_ID || new Date().toISOString();
const headerPolicy = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1];
if (!headerPolicy) throw new Error('The static Content-Security-Policy is missing.');
// Pages has no custom response headers. Keep supported directives in the HTML too.
const metaPolicy = headerPolicy.split(';').map(directive => directive.trim()).filter(directive => directive && !/^(?:frame-ancestors|sandbox|report-uri|report-to)\b/.test(directive)).join('; ');

export default defineConfig({
  base,
  define: { __FEX_BUILD_ID__: JSON.stringify(buildId) },
  build: { manifest: true, target: 'es2022' },
  plugins: [{
    name: 'fex-static-content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: metaPolicy }, injectTo: 'head-prepend' }];
    },
  }, VitePWA({
    strategies: 'injectManifest', srcDir: 'src/pwa', filename: 'sw.js',
    injectRegister: false, registerType: 'prompt',
    // The plugin adds the manifest itself. The file patterns include the manifest's icons.
    includeManifestIcons: false,
    injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png}'], globIgnores: ['social.svg'] },
    manifest: {
      id: base, name: 'Fex', short_name: 'Fex', description: 'A simple currency converter.',
      start_url: base, scope: base, display: 'standalone', background_color: '#0c0e0d', theme_color: '#0c0e0d',
      icons: [192, 512].flatMap(size => [
        { src: `${base}icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' },
        { src: `${base}icons/maskable-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' },
      ]),
    },
  })],
});
