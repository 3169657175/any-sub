const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const archivePath = path.join(root, 'assets', 'app.asar');
const reportPath = path.join(__dirname, 'last-verify-report.json');
const requiredFiles = [
  'package.json',
  'dist/languageServer.js',
  'dist/preload.js',
  'dist/main.js',
  'dist/ipcHandlers.js',
  'dist/accountVault.js'
];
const syntaxFiles = [
  'dist/languageServer.js',
  'dist/preload.js',
  'dist/main.js',
  'dist/ipcHandlers.js',
  'dist/accountVault.js'
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeReport(report) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

function requireText(source, expected, file) {
  if (!source.includes(expected)) {
    throw new Error(`${file} is missing required runtime marker: ${expected}`);
  }
}

function rejectText(source, forbidden, file) {
  if (source.includes(forbidden)) {
    throw new Error(`${file} contains obsolete runtime logic: ${forbidden}`);
  }
}

if (!fs.existsSync(archivePath)) {
  const report = { verifiedAt: new Date().toISOString(), ok: false, error: `Missing archive: ${archivePath}` };
  writeReport(report);
  throw new Error(report.error);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-patch-verify-'));
let tempCleaned = false;

function cleanupTemp() {
  if (tempCleaned) return;
  tempCleaned = true;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

process.once('exit', cleanupTemp);

try {
  const extractDir = path.join(tempRoot, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });
  asar.extractAll(archivePath, extractDir);

  const missingFiles = requiredFiles.filter(relativePath => !fs.existsSync(path.join(extractDir, relativePath)));
  if (missingFiles.length > 0) {
    throw new Error(`Patch archive is missing required files: ${missingFiles.join(', ')}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(extractDir, 'package.json'), 'utf8'));
  const checkedSyntax = [];
  for (const relativePath of syntaxFiles) {
    const source = fs.readFileSync(path.join(extractDir, relativePath), 'utf8');
    new vm.Script(source, { filename: relativePath });
    checkedSyntax.push(relativePath);
  }

  const languageServerSource = fs.readFileSync(path.join(extractDir, 'dist/languageServer.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(extractDir, 'dist/main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(extractDir, 'dist/preload.js'), 'utf8');
  const ipcHandlersSource = fs.readFileSync(path.join(extractDir, 'dist/ipcHandlers.js'), 'utf8');
  requireText(languageServerSource, "TOKEN_MONITOR_API_PORT = 31000", 'dist/languageServer.js');
  requireText(languageServerSource, "TOKEN_MONITOR_CLOUD_PORT = 31001", 'dist/languageServer.js');
  requireText(languageServerSource, 'isTokenMonitorAvailable()', 'dist/languageServer.js');
  requireText(languageServerSource, 'https://generativelanguage.googleapis.com', 'dist/languageServer.js');
  requireText(languageServerSource, 'https://daily-cloudcode-pa.googleapis.com', 'dist/languageServer.js');
  requireText(mainSource, "ipcMain.on('token:report'", 'dist/main.js');
  requireText(preloadSource, "ipcRenderer.send('token:report'", 'dist/preload.js');
  rejectText(preloadSource, "origFetch('http://127.0.0.1:31000/report-token'", 'dist/preload.js');
  requireText(ipcHandlersSource, 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', 'dist/ipcHandlers.js');
  rejectText(ipcHandlersSource, 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', 'dist/ipcHandlers.js');
  rejectText(ipcHandlersSource, 'if (gemini5hVal === null) gemini5hVal = 100;', 'dist/ipcHandlers.js');

  const runtimeChecks = [
    'model API uses port 31000',
    'Cloud Code uses port 31001',
    'official endpoint fallback is present',
    'Token reporting uses IPC',
    'account quota uses the daily Cloud Code endpoint',
    'missing account quota is not reported as 100%'
  ];

  const report = {
    verifiedAt: new Date().toISOString(),
    ok: true,
    archivePath,
    archiveSize: fs.statSync(archivePath).size,
    archiveSha256: sha256(archivePath),
    packageName: packageJson.name || '',
    packageVersion: packageJson.version || '',
    requiredFiles,
    checkedSyntax,
    runtimeChecks
  };
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    verifiedAt: new Date().toISOString(),
    ok: false,
    archivePath,
    error: error.message
  };
  writeReport(report);
  console.error(error);
  process.exitCode = 1;
} finally {
  cleanupTemp();
}
