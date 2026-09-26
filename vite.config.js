import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const rawBase = process.env.FEX_BASE_PATH || '/';
const base = `/${rawBase.split('/').filter(Boolean).join('/')}${rawBase === '/' ? '' : '/'}`;
const buildId = process.env.FEX_BUILD_ID || new Date().toISOString();

export default defineConfig({
  base,
  define: { __FEX_BUILD_ID__: JSON.stringify(buildId) },
  build: { manifest: true, target: 'es2022' },
  plugins: [VitePWA({
    strategies: 'injectManifest', srcDir: 'src/pwa', filename: 'sw.js',
    injectRegister: false, registerType: 'prompt',
    injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'], globIgnores: ['social.svg'] },
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
