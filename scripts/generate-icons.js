const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;

const ASSETS = path.join(__dirname, "..", "assets");
const SVG_PATH = path.join(ASSETS, "icon.svg");
const PNG_SIZES = [16, 32, 48, 128, 256];

async function main() {
  const svg = fs.readFileSync(SVG_PATH);

  for (const size of PNG_SIZES) {
    const buf = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    fs.writeFileSync(path.join(ASSETS, `icon-${size}.png`), buf);
  }
  fs.copyFileSync(path.join(ASSETS, "icon-256.png"), path.join(ASSETS, "icon.png"));

  const icoBuffer = await pngToIco(path.join(ASSETS, "icon-256.png"));
  fs.writeFileSync(path.join(ASSETS, "icon.ico"), icoBuffer);

  console.log("Ícones gerados em", ASSETS);
}

main().catch((e) => { console.error(e); process.exit(1); });
