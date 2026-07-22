const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'assets');
const sourceAsar = path.join(assetsDir, 'app.asar');
const baselineAsar = path.join(assetsDir, 'app.asar.baseline_stable');
const baselineMeta = path.join(__dirname, 'baseline-meta.json');

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

if (!fs.existsSync(sourceAsar)) {
  throw new Error(`Missing source archive: ${sourceAsar}`);
}

fs.copyFileSync(sourceAsar, baselineAsar);

const meta = {
  createdAt: new Date().toISOString(),
  baselineAsar: baselineAsar,
  size: fs.statSync(baselineAsar).size,
  sha256: sha256(baselineAsar)
};

fs.writeFileSync(baselineMeta, JSON.stringify(meta, null, 2), 'utf8');
console.log(JSON.stringify(meta, null, 2));
