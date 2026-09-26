import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="108" fill="#0c0e0d"/><g fill="none" stroke="#b8e5c1" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"><path d="M142 206h228l-65-65M370 306H142l65 65"/></g></svg>`;
await mkdir('public/icons', { recursive: true });
await writeFile('public/icons/source.svg', svg);
for (const size of [192, 512]) {
  await sharp(Buffer.from(svg)).resize(size).png().toFile(`public/icons/icon-${size}.png`);
  const maskable = svg.replace('rx="108"', 'rx="0"').replace('<g fill=', '<g transform="translate(51.2 51.2) scale(.8)" fill=');
  await sharp(Buffer.from(maskable)).resize(size).png().toFile(`public/icons/maskable-${size}.png`);
}
await sharp(Buffer.from(svg)).resize(180).png().toFile('public/icons/apple-touch-icon.png');
