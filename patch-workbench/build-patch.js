const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const asar = require('@electron/asar');

const workbenchDir = __dirname;
const root = path.resolve(workbenchDir, '..');
const assetsDir = path.join(root, 'assets');
const baselineAsar = path.join(assetsDir, 'app.asar.baseline_stable');
const outputAsar = path.join(assetsDir, 'app.asar');
const reportPath = path.join(workbenchDir, 'last-build-report.json');
const rulesPath = path.join(workbenchDir, 'translation-rules.json');
const headerPath = path.join(workbenchDir, 'injections', 'preload-header.js');
const footerPath = path.join(workbenchDir, 'injections', 'preload-footer.js');

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function ensureArray(value, filePath) {
  if (!Array.isArray(value)) {
    throw new Error(`${filePath} must contain a JSON array`);
  }
  return value;
}

function applyLiteralRule(source, rule, index) {
  if (!rule || rule.enabled === false) {
    return { source, changed: false, hits: 0 };
  }
  const find = String(rule.find || '');
  const replace = String(rule.replace || '');
  if (!find) {
    throw new Error(`Rule ${index + 1} has an empty find value`);
  }
  const hits = source.split(find).length - 1;
  if (hits === 0) {
    throw new Error(`Rule ${index + 1} did not match: ${find}`);
  }
  return {
    source: source.split(find).join(replace),
    changed: true,
    hits
  };
}

function writeReport(report) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

if (!fs.existsSync(baselineAsar)) {
  throw new Error(`Missing frozen baseline: ${baselineAsar}. Run npm run patch:baseline first.`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-patch-build-'));
let tempCleaned = false;

function cleanupTemp() {
  if (tempCleaned) return;
  tempCleaned = true;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

process.once('exit', cleanupTemp);
const extractDir = path.join(tempRoot, 'extract');
fs.mkdirSync(extractDir, { recursive: true });
asar.extractAll(baselineAsar, extractDir);

const preloadPath = path.join(extractDir, 'dist', 'preload.js');
if (!fs.existsSync(preloadPath)) {
  throw new Error(`Baseline archive is missing dist/preload.js`);
}

const originalPreload = fs.readFileSync(preloadPath, 'utf8');
let rebuiltPreload = originalPreload;
const rules = ensureArray(JSON.parse(fs.readFileSync(rulesPath, 'utf8')), rulesPath);
const appliedRules = [];

rules.forEach((rule, index) => {
  const result = applyLiteralRule(rebuiltPreload, rule, index);
  rebuiltPreload = result.source;
  if (result.changed) {
    appliedRules.push({
      index: index + 1,
      description: rule.description || '',
      hits: result.hits
    });
  }
});

const header = readText(headerPath).trim();
const footer = readText(footerPath).trim();

if (header) {
  rebuiltPreload = `${header}\n\n${rebuiltPreload}`;
}
if (footer) {
  rebuiltPreload = `${rebuiltPreload}\n\n${footer}\n`;
}

new vm.Script(rebuiltPreload, { filename: 'dist/preload.js' });
fs.writeFileSync(preloadPath, rebuiltPreload, 'utf8');

const builtTempAsar = path.join(tempRoot, 'app.asar');

Promise.resolve()
  .then(() => asar.createPackage(extractDir, builtTempAsar))
  .then(() => {
    fs.copyFileSync(builtTempAsar, outputAsar);
    const report = {
      builtAt: new Date().toISOString(),
      baselineAsar,
      outputAsar,
      originalPreloadHash: sha256Buffer(Buffer.from(originalPreload, 'utf8')),
      rebuiltPreloadHash: sha256Buffer(Buffer.from(rebuiltPreload, 'utf8')),
      headerInjected: Boolean(header),
      footerInjected: Boolean(footer),
      appliedRules,
      outputSize: fs.statSync(outputAsar).size
    };
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
  })
  .catch(error => {
    writeReport({
      builtAt: new Date().toISOString(),
      error: error.message
    });
    console.error(error);
    process.exit(1);
  })
  .finally(cleanupTemp);
