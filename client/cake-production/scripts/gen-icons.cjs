// One-off icon generator: rasterizes icon-source.svg into the PNG sizes
// PWA installability needs. Uses `sharp` from server/node_modules (dev-time
// tool only — not a runtime dependency of this app).
const path = require('path');
const sharp = require(path.join(__dirname, '../../../server/node_modules/sharp'));

const src = path.join(__dirname, 'icon-source.svg');
const outDir = path.join(__dirname, '../public');

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512 },
  { file: 'icon-180-apple-touch.png', size: 180 },
];

(async () => {
  for (const t of targets) {
    await sharp(src).resize(t.size, t.size).png().toFile(path.join(outDir, t.file));
    console.log('wrote', t.file);
  }
})();
