const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const physicalFs = require('original-fs');
const os = require('os');
const crypto = require('crypto');
const vm = require('vm');
const asar = require('@electron/asar');
const { exec, execFileSync, spawn } = require('child_process');
const { startProxy, getInitialStats, getProxyStatus, recordTokenLog } = require('./proxy.js');
const { BrainTokenMonitor } = require('./brainMonitor.js');
const AGY_THEME_CATALOG = [
  { id: 'doraemon', name: '哆啦A梦', file: '哆啦A梦.png', accent: '#3ba5fc', overlay: 0.18, position: 'center center', description: '蓝天白云与哆啦A梦，明快清爽。' },
  { id: 'shinchan', name: '蜡笔小新', file: '蜡笔小新.jpg', accent: '#fbd160', overlay: 0.16, position: 'center center', description: '樱花、蓝天、公园与小新小白，明快而不杂乱。' },
  { id: 'line-dog', name: '线条小狗', file: '线条小狗.png', accent: '#52c49c', overlay: 0.14, position: 'center center', description: '晴空草地与野餐小狗，温暖安静。' },
  { id: 'one-piece', name: '海贼王', file: '海贼王.png', accent: '#fca240', overlay: 0.20, position: 'center center', description: '草帽团共望日落海面，完整群像与克制暖色。' },
  { id: 'fox-spirit', name: '狐妖小红娘', file: '狐妖小红娘.png', accent: '#f06c8b', overlay: 0.18, position: 'center center', description: '苏苏坐在樱花草地，主体靠右且留白充足。' }
];

function getAgyThemePaths() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const configDir = path.join(appData, 'Antigravity');
  return {
    configDir,
    assetsDir: path.join(configDir, 'agy-themes'),
    customAssetsDir: path.join(configDir, 'agy-themes', 'custom'),
    configFile: path.join(configDir, 'agy-theme.json'),
    libraryFile: path.join(configDir, 'agy-theme-library.json')
  };
}

function readAgyThemeLibrary() {
  const paths = getAgyThemePaths();
  try {
    const value = JSON.parse(fs.readFileSync(paths.libraryFile, 'utf8'));
    return {
      version: 1,
      overrides: value && typeof value.overrides === 'object' ? value.overrides : {},
      customs: Array.isArray(value && value.customs) ? value.customs : []
    };
  } catch (_) {
    return { version: 1, overrides: {}, customs: [] };
  }
}

function writeAgyThemeLibrary(library) {
  const paths = getAgyThemePaths();
  fs.mkdirSync(paths.configDir, { recursive: true });
  const temporary = `${paths.libraryFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({
    version: 1,
    overrides: library.overrides || {},
    customs: Array.isArray(library.customs) ? library.customs : []
  }, null, 2), 'utf8');
  fs.renameSync(temporary, paths.libraryFile);
  return library;
}

function getImageMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function imageToDataUrl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return `data:${getImageMime(filePath)};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function validateThemeImage(filePath) {
  if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
    throw new Error('请选择有效的主题图片');
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    throw new Error('仅支持 JPG、PNG 或 WebP 图片');
  }
  const size = fs.statSync(filePath).size;
  if (size <= 0 || size > 40 * 1024 * 1024) {
    throw new Error('图片大小必须在 40MB 以内');
  }
  return extension;
}

function resolveThemeLibraryItems() {
  const paths = getAgyThemePaths();
  const library = readAgyThemeLibrary();
  const builtins = AGY_THEME_CATALOG.map(theme => {
    const override = library.overrides[theme.id];
    const overridePath = override && override.imageFile
      ? path.join(paths.customAssetsDir, override.imageFile)
      : '';
    const imagePath = overridePath && fs.existsSync(overridePath)
      ? overridePath
      : findBundledThemeFile(theme.file);
    return {
      ...theme,
      kind: 'builtin',
      paletteId: theme.id,
      imagePath,
      isCustomized: Boolean(overridePath && fs.existsSync(overridePath)),
      previewDataUrl: imageToDataUrl(imagePath)
    };
  });
  const customs = library.customs.map(item => {
    const palette = AGY_THEME_CATALOG.find(theme => theme.id === item.paletteId) || AGY_THEME_CATALOG[0];
    const imagePath = item.imageFile ? path.join(paths.customAssetsDir, item.imageFile) : '';
    return {
      id: item.id,
      name: item.name,
      kind: 'custom',
      paletteId: palette.id,
      paletteName: palette.name,
      accent: palette.accent,
      overlay: palette.overlay,
      position: palette.position,
      description: `自定义壁纸 · ${palette.name}色调`,
      imagePath,
      previewDataUrl: imageToDataUrl(imagePath),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }).filter(item => item.previewDataUrl);
  return { library, themes: [...builtins, ...customs] };
}

function findBundledThemeFile(fileName) {
  if (!fileName || typeof fileName !== 'string') return '';
  const candidates = [
    path.join(__dirname, 'assets', 'themes', fileName),
    path.join(process.resourcesPath || '', 'assets', 'themes', fileName),
    path.join(os.homedir(), 'Desktop', 'antigravity换皮', fileName),
    path.join(os.homedir(), 'Desktop', 'antigravity换皮', 'themes', fileName)
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || '';
}

function installAgyThemeAssets() {
  const paths = getAgyThemePaths();
  fs.mkdirSync(paths.assetsDir, { recursive: true });
  const allowed = new Set(AGY_THEME_CATALOG.map(theme => theme.file));
  for (const entry of fs.readdirSync(paths.assetsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(extension) && !allowed.has(entry.name)) {
      fs.unlinkSync(path.join(paths.assetsDir, entry.name));
    }
  }
  for (const theme of AGY_THEME_CATALOG) {
    const source = findBundledThemeFile(theme.file);
    if (!source) continue;
    const destination = path.join(paths.assetsDir, theme.file);
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const destinationHash = fs.existsSync(destination)
      ? crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')
      : '';
    if (sourceHash !== destinationHash) {
      fs.copyFileSync(source, destination);
    }
  }
  return paths;
}

function readAgyThemeConfig() {
  const paths = getAgyThemePaths();
  try {
    return JSON.parse(fs.readFileSync(paths.configFile, 'utf8'));
  } catch (_) {
    return { version: 1, enabled: false, id: 'native' };
  }
}

function writeAgyThemeConfig(config) {
  const paths = getAgyThemePaths();
  fs.mkdirSync(paths.configDir, { recursive: true });
  const temporary = `${paths.configFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(temporary, paths.configFile);
  return config;
}

function activateResolvedTheme(theme) {
  if (!theme || !theme.imagePath || !fs.existsSync(theme.imagePath)) {
    throw new Error('主题图片不存在，请重新选择图片');
  }
  const isCustom = theme.kind === 'custom';
  return writeAgyThemeConfig({
    version: 1,
    enabled: true,
    id: isCustom ? theme.paletteId : theme.id,
    sourceThemeId: isCustom ? theme.id : undefined,
    isCustom,
    name: theme.name,
    imagePath: theme.imagePath,
    accent: theme.accent,
    overlay: theme.overlay,
    backgroundPosition: theme.position,
    updatedAt: new Date().toISOString()
  });
}

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SKILL_CATALOG_BASE = 'https://raw.githubusercontent.com/sickn33/agentic-awesome-skills/refs/heads/main';

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function getGlobalMcpConfigPath() {
  return path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
}

function getGlobalSkillsDir() {
  return path.join(os.homedir(), '.gemini', 'config', 'skills');
}

function normalizeSkillId(value) {
  const skillId = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(skillId)) {
    throw new Error('技能标识只能包含小写英文字母、数字和连字符，长度为 2-64 个字符');
  }
  return skillId;
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AGY-Hub/1.0' }
    });
    if (!response.ok) throw new Error(`远程服务器返回 HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AGY-Hub/1.0' }
    });
    if (!response.ok) throw new Error(`远程服务器返回 HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function validateSkillContent(content) {
  const text = String(content || '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    throw new Error('SKILL.md 缺少 YAML frontmatter');
  }
  if (!/^description:\s*.+$/m.test(text)) {
    throw new Error('SKILL.md 缺少 description 字段');
  }
  return text;
}

function stopChildTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.unref();
  } else {
    child.kill('SIGTERM');
  }
}

function validateMcpLaunchConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('MCP 配置为空');
  const command = String(config.command || '').trim();
  const args = Array.isArray(config.args) ? config.args.map(value => String(value)) : [];
  const allowedCommands = new Set(['cmd', 'cmd.exe', process.env.ComSpec].filter(Boolean).map(value => value.toLowerCase()));
  if (!allowedCommands.has(command.toLowerCase())) {
    throw new Error('为安全起见，桌面管家只验证通过 cmd.exe 启动的 npm MCP 服务');
  }
  if (!args.some(value => /^(?:@?[a-z0-9][a-z0-9@/._-]*|chrome-devtools-mcp)$/i.test(value))) {
    throw new Error('MCP 启动参数中缺少有效的软件包名称');
  }
  return { command, args, env: config.env && typeof config.env === 'object' ? config.env : {} };
}

function probeMcpServer(config, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let launch;
    try {
      launch = validateMcpLaunchConfig(config);
    } catch (error) {
      resolve({ success: false, stage: 'config', error: error.message });
      return;
    }

    const startedAt = Date.now();
    const child = spawn(launch.command, launch.args, {
      env: { ...process.env, ...launch.env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopChildTree(child);
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => {
      finish({
        success: false,
        stage: 'timeout',
        error: `启动超过 ${Math.round(timeoutMs / 1000)} 秒，可能是下载缓慢、缺少依赖或服务未响应`,
        details: stderrBuffer.slice(-600)
      });
    }, timeoutMs);

    child.on('error', (error) => {
      finish({ success: false, stage: 'spawn', error: `无法启动 MCP 进程：${error.message}` });
    });

    child.stderr.on('data', chunk => {
      stderrBuffer += chunk.toString('utf8');
      if (stderrBuffer.length > 4000) stderrBuffer = stderrBuffer.slice(-4000);
    });

    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const message = JSON.parse(trimmed);
          if (message.id !== 1) continue;
          if (message.error) {
            finish({ success: false, stage: 'handshake', error: message.error.message || 'MCP 初始化被拒绝' });
            return;
          }
          if (message.result && message.result.serverInfo) {
            try {
              child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
            } catch (_) {}
            finish({
              success: true,
              stage: 'ready',
              serverName: message.result.serverInfo.name || 'MCP Server',
              serverVersion: message.result.serverInfo.version || '',
              protocolVersion: message.result.protocolVersion || MCP_PROTOCOL_VERSION
            });
            return;
          }
        } catch (_) {}
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        finish({
          success: false,
          stage: 'exit',
          error: `MCP 进程在完成握手前退出（代码 ${code ?? 'unknown'}）`,
          details: stderrBuffer.slice(-600)
        });
      }
    });

    const initializeMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'agy-hub-validator', version: '1.0.0' }
      }
    };
    child.stdin.write(`${JSON.stringify(initializeMessage)}\n`);
  });
}

function replaceDirectory(sourceDir, targetDir) {
  const parentDir = path.dirname(targetDir);
  const tempDir = path.join(parentDir, `.${path.basename(targetDir)}.installing-${process.pid}-${Date.now()}`);
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, tempDir, { recursive: true, force: true });

  let removed = false;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      removed = true;
      break;
    } catch (err) {
      if (!['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(err.code)) throw err;
      sleepSync(200);
    }
  }
  if (!removed && fs.existsSync(targetDir)) {
    const trashDir = path.join(parentDir, `.${path.basename(targetDir)}.trash-${Date.now()}`);
    try {
      fs.renameSync(targetDir, trashDir);
      setTimeout(() => { try { fs.rmSync(trashDir, { recursive: true, force: true }); } catch (e) {} }, 1000);
    } catch (e) {}
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.renameSync(tempDir, targetDir);
      return;
    } catch (err) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
      sleepSync(200);
    }
  }
  fs.renameSync(tempDir, targetDir);
}

function hashFileSync(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = physicalFs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = physicalFs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    physicalFs.closeSync(fd);
  }
}

function inspectPatchArchive(archivePath, requiredFiles) {
  const entries = new Set(asar.listPackage(archivePath).map(entry =>
    String(entry).replace(/^[/\\]+/, '').replace(/\\/g, '/')
  ));
  const packageJson = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8').replace(/^\uFEFF/, ''));
  const syntaxErrors = [];
  for (const entry of ['dist/main.js', 'dist/preload.js']) {
    if (!entries.has(entry)) continue;
    try {
      const source = asar.extractFile(archivePath, entry).toString('utf8');
      new vm.Script(source, { filename: entry });
    } catch (error) {
      syntaxErrors.push(`${entry}: ${error.message}`);
    }
  }
  return {
    version: normalizeClientVersion(packageJson.version),
    missingFiles: requiredFiles.filter(file => !entries.has(String(file).replace(/\\/g, '/'))),
    syntaxErrors
  };
}

function getDirectoryStats(directory) {
  let files = 0;
  let bytes = 0;
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(fullPath).size;
      }
    }
  };
  visit(directory);
  return { files, bytes };
}

function getWindowsFileVersion(executable) {
  const command = '& { param([string]$p) (Get-Item -LiteralPath $p).VersionInfo.ProductVersion }';
  return execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', command, executable
  ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function normalizeClientVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).join('.') : '';
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function stopAntigravityForPatch(asarPath) {
  const appDir = path.dirname(path.dirname(asarPath));
  const executable = path.join(appDir, 'Antigravity.exe');
  let wasRunning = false;
  try {
    const tasks = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq Antigravity.exe', '/NH'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    wasRunning = /antigravity\.exe/i.test(tasks);
  } catch (e) {}
  if (wasRunning) {
    execFileSync('taskkill.exe', ['/F', '/T', '/IM', 'Antigravity.exe'], {
      windowsHide: true, stdio: 'ignore'
    });
    sleepSync(300);
  }
  const unpackedDir = `${asarPath}.unpacked`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const fd = physicalFs.openSync(asarPath, 'r+');
      physicalFs.closeSync(fd);

      if (fs.existsSync(unpackedDir)) {
        const testLockFile = path.join(unpackedDir, '.locktest');
        fs.writeFileSync(testLockFile, 'test');
        fs.unlinkSync(testLockFile);
      }
      return { wasRunning, executable };
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'EACCES', 'ENOENT'].includes(error.code)) throw error;
      sleepSync(150);
    }
  }
  throw new Error('Antigravity 及其依赖文件句柄未完全释放，请稍后重试。');
}

function restartAntigravityAfterPatch(state) {
  if (!state || !state.wasRunning || !fs.existsSync(state.executable)) return;
  const child = spawn(state.executable, [], {
    cwd: path.dirname(state.executable), detached: true, windowsHide: false, stdio: 'ignore'
  });
  child.unref();
}

function normalizeAccountEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const match = /^([\w.+-]+@[\w.-]+\.(?:com\.cn|net\.cn|org\.cn|gov\.cn|com|net|org|edu|gov|io|ai|cn|co|me|dev|app|xyz|top|tech|cloud))/i.exec(email);
  return match ? match[1].toLowerCase() : email;
}

let mainWindow;
let tray = null;
let brainTokenMonitor = null;

function createWindow() {
  try {
    fs.writeFileSync(path.join(process.resourcesPath, '../userDataPath.txt'), app.getPath('userData'), 'utf8');
  } catch (err) {}
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 680,
    minWidth: 900,
    minHeight: 600,
    frame: false, // 无边框窗口，启用自定义霓虹标题栏
    transparent: false,
    backgroundColor: '#0a0a0c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');

  app.on('before-quit', () => {
    app.isQuiting = true;
  });

  // 拦截关闭事件：点击叉号时仅隐藏窗口，保留后台默默守护状态
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault(); // 阻止默认的窗口销毁
      mainWindow.hide();       // 隐藏主窗口
    }
    return false;
  });

  // 开发调试可用 Ctrl+Shift+I 唤醒
  // mainWindow.webContents.openDevTools();
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 当试图启动第二个实例时，唤醒并显示已有的主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    startProxy(mainWindow, 31000, 'https://generativelanguage.googleapis.com');
    brainTokenMonitor = new BrainTokenMonitor({ onLog: recordTokenLog });
    brainTokenMonitor.start().catch(error => {
      console.error('[Token Monitor] Local transcript monitor failed:', error);
    });

    // 启动 3 秒后静默后台自动检测更新
    setTimeout(() => {
      try { autoUpdater.checkForUpdates(); } catch (_) {}
    }, 3000);

    // 创建系统托盘图标 (指向 assets/icon.ico)
    const iconPath = path.join(__dirname, 'assets', 'icon.ico');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: '显示管家', 
        click: () => {
          mainWindow.show();
        } 
      },
      { type: 'separator' },
      { 
        label: '退出管家', 
        click: () => {
          app.isQuiting = true;
          app.quit();
        } 
      }
    ]);

    tray.setToolTip('AGY Hub 桌面管家');
    tray.setContextMenu(contextMenu);

    // 双击托盘图标，还原展示主窗口
    tray.on('double-click', () => {
      mainWindow.show();
    });

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin' && app.isQuiting) app.quit();
});

app.on('before-quit', () => {
  if (brainTokenMonitor) brainTokenMonitor.stop();
});

// ==========================================
// IPC 通信事件监听
// ==========================================

// 窗口控制
ipcMain.on('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  mainWindow.close();
});

ipcMain.handle('get-token-stats', () => getInitialStats());
ipcMain.handle('get-token-monitor-status', () => {
  const proxy = getProxyStatus();
  const localMonitor = brainTokenMonitor
    ? brainTokenMonitor.getStatus()
    : { ready: false, watchedFiles: 0, lastActivityAt: null, lastError: '' };
  let routed = false;
  let routeMessage = '';
  try {
    const logPath = path.join(app.getPath('appData'), 'Antigravity', 'logs', 'main.log');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      const routedMarker = '[Token Monitor] Routing model traffic through';
      const directMarker = '[Token Monitor] AGY Hub is unavailable';
      const routedIndex = content.lastIndexOf(routedMarker);
      const directIndex = content.lastIndexOf(directMarker);
      routed = routedIndex >= 0 && routedIndex > directIndex;
      routeMessage = routed ? 'Antigravity traffic is routed through the monitor.' : 'Restart Antigravity after the monitor is ready.';
    }
  } catch (error) {
    routeMessage = error.message;
  }
  return { ...proxy, routed, routeMessage, localMonitor };
});
ipcMain.handle('start-token-proxy', (event, port, upstream) => {
  startProxy(mainWindow, port, upstream);
  return true;
});

ipcMain.handle('focus-main-window', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
  mainWindow.webContents.focus();
  return mainWindow.isFocused();
});

ipcMain.handle('list-themes', async () => {
  try {
    installAgyThemeAssets();
    const { themes } = resolveThemeLibraryItems();
    return {
      success: true,
      themes,
      palettes: AGY_THEME_CATALOG.map(({ id, name, accent }) => ({ id, name, accent })),
      active: readAgyThemeConfig()
    };
  } catch (error) {
    return { success: false, error: error.message, themes: [], active: { enabled: false, id: 'native' } };
  }
});

ipcMain.handle('get-active-theme', async () => ({ success: true, active: readAgyThemeConfig() }));

ipcMain.handle('pick-theme-image', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Antigravity 主题图片',
      properties: ['openFile'],
      filters: [{ name: '主题图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { success: true, canceled: true };
    const filePath = result.filePaths[0];
    validateThemeImage(filePath);
    return {
      success: true,
      canceled: false,
      filePath,
      fileName: path.basename(filePath),
      previewDataUrl: imageToDataUrl(filePath)
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-theme-design', async (_event, payload = {}) => {
  try {
    installAgyThemeAssets();
    const paths = getAgyThemePaths();
    fs.mkdirSync(paths.customAssetsDir, { recursive: true });
    const library = readAgyThemeLibrary();
    const now = new Date().toISOString();
    const selectedImagePath = typeof payload.imagePath === 'string' ? payload.imagePath : '';
    let savedThemeId = String(payload.themeId || '');

    if (payload.create) {
      const palette = AGY_THEME_CATALOG.find(theme => theme.id === payload.paletteId);
      if (!palette) throw new Error('请选择一种主题色调');
      const extension = validateThemeImage(selectedImagePath);
      const name = String(payload.name || '').trim().slice(0, 30) || '我的自定义皮肤';
      savedThemeId = `custom-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      const imageFile = `${savedThemeId}${extension}`;
      fs.copyFileSync(selectedImagePath, path.join(paths.customAssetsDir, imageFile));
      library.customs.push({
        id: savedThemeId,
        name,
        paletteId: palette.id,
        imageFile,
        createdAt: now,
        updatedAt: now
      });
    } else {
      const builtin = AGY_THEME_CATALOG.find(theme => theme.id === savedThemeId);
      const custom = library.customs.find(theme => theme.id === savedThemeId);
      if (!builtin && !custom) throw new Error('找不到需要编辑的皮肤');

      if (selectedImagePath) {
        const extension = validateThemeImage(selectedImagePath);
        const previousFile = builtin
          ? library.overrides[builtin.id] && library.overrides[builtin.id].imageFile
          : custom.imageFile;
        const imageFile = `${builtin ? `builtin-${builtin.id}` : custom.id}-${Date.now().toString(36)}${extension}`;
        fs.copyFileSync(selectedImagePath, path.join(paths.customAssetsDir, imageFile));
        if (previousFile) {
          const previousPath = path.join(paths.customAssetsDir, previousFile);
          if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
        }
        if (builtin) library.overrides[builtin.id] = { imageFile, updatedAt: now };
        else custom.imageFile = imageFile;
      }

      if (custom) {
        const palette = AGY_THEME_CATALOG.find(theme => theme.id === payload.paletteId);
        if (!palette) throw new Error('请选择一种主题色调');
        custom.name = String(payload.name || custom.name).trim().slice(0, 30) || custom.name;
        custom.paletteId = palette.id;
        custom.updatedAt = now;
      }
    }

    writeAgyThemeLibrary(library);
    const { themes } = resolveThemeLibraryItems();
    const savedTheme = themes.find(theme => theme.id === savedThemeId);
    if (!savedTheme) throw new Error('皮肤保存后无法读取');
    const current = readAgyThemeConfig();
    const currentSourceId = current.sourceThemeId || current.id;
    const active = current.enabled && currentSourceId === savedThemeId
      ? activateResolvedTheme(savedTheme)
      : current;
    return { success: true, theme: savedTheme, themes, active };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reset-theme-image', async (_event, themeId) => {
  try {
    const builtin = AGY_THEME_CATALOG.find(theme => theme.id === themeId);
    if (!builtin) throw new Error('只有内置皮肤可以恢复默认图片');
    const paths = getAgyThemePaths();
    const library = readAgyThemeLibrary();
    const override = library.overrides[builtin.id];
    if (override && override.imageFile) {
      const overridePath = path.join(paths.customAssetsDir, override.imageFile);
      if (fs.existsSync(overridePath)) fs.unlinkSync(overridePath);
    }
    delete library.overrides[builtin.id];
    writeAgyThemeLibrary(library);
    const { themes } = resolveThemeLibraryItems();
    const theme = themes.find(item => item.id === themeId);
    const current = readAgyThemeConfig();
    const active = current.enabled && (current.sourceThemeId || current.id) === themeId
      ? activateResolvedTheme(theme)
      : current;
    return { success: true, themes, active };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-custom-theme', async (_event, themeId) => {
  try {
    const paths = getAgyThemePaths();
    const library = readAgyThemeLibrary();
    const index = library.customs.findIndex(theme => theme.id === themeId);
    if (index < 0) throw new Error('找不到该自定义皮肤');
    const [removed] = library.customs.splice(index, 1);
    if (removed.imageFile) {
      const imagePath = path.join(paths.customAssetsDir, removed.imageFile);
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
    writeAgyThemeLibrary(library);
    const current = readAgyThemeConfig();
    const wasActive = current.enabled && current.sourceThemeId === themeId;
    const active = wasActive
      ? writeAgyThemeConfig({ version: 1, enabled: false, id: 'native', name: '原生主题', updatedAt: new Date().toISOString() })
      : current;
    return { success: true, themes: resolveThemeLibraryItems().themes, active };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-active-theme', async (_event, themeId) => {
  try {
    installAgyThemeAssets();
    const { themes } = resolveThemeLibraryItems();
    const theme = themes.find(item => item.id === themeId);
    if (!theme) throw new Error('未知主题');
    const active = activateResolvedTheme(theme);
    return { success: true, active, configFile: getAgyThemePaths().configFile };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disable-theme', async () => {
  try {
    const current = readAgyThemeConfig();
    const active = writeAgyThemeConfig({ ...current, enabled: false, id: 'native', name: '原生主题', updatedAt: new Date().toISOString() });
    return { success: true, active };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 自动检测 Antigravity 安装路径
ipcMain.handle('detect-paths', async () => {
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  
  // 常见安装路径列表
  const possiblePaths = [
    path.join(localAppData, 'Programs', 'antigravity-ide'),
    path.join(localAppData, 'Programs', 'Antigravity'),
    path.join(appData, 'Antigravity'),
    'C:\\Program Files\\Antigravity',
    'C:\\Program Files (x86)\\Antigravity'
  ];

  let detectedPath = '';
  let asarPath = '';

  for (const p of possiblePaths) {
    const testAsar = path.join(p, 'resources', 'app.asar');
    if (fs.existsSync(testAsar)) {
      detectedPath = p;
      asarPath = testAsar;
      break;
    }
  }

  // 默认配置文件路径
  const mcpConfigPath = getGlobalMcpConfigPath();
  const mcpConfigExists = fs.existsSync(mcpConfigPath);

  return {
    detected: !!detectedPath,
    installDir: detectedPath,
    asarPath: asarPath,
    mcpConfigPath: mcpConfigPath,
    mcpConfigExists: mcpConfigExists
  };
});

// 读取 MCP 配置文件
ipcMain.handle('read-mcp-config', async (event, configPath) => {
  try {
    if (!fs.existsSync(configPath)) {
      return { success: false, error: '配置文件不存在' };
    }
    const content = fs.readFileSync(configPath, 'utf8');
    return { success: true, data: JSON.parse(content) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 写入 MCP 配置文件
ipcMain.handle('write-mcp-config', async (event, { configPath, data }) => {
  try {
    const officialPath = getGlobalMcpConfigPath();
    if (path.resolve(configPath) !== path.resolve(officialPath)) {
      return { success: false, error: '拒绝写入非官方 MCP 配置目录' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { success: false, error: 'MCP 配置格式无效' };
    }
    writeJsonAtomic(officialPath, data);
    return { success: true, path: officialPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('validate-mcp-server', async (event, config) => {
  return probeMcpServer(config);
});

// 写入 Skill (SKILL.md) 配置文件
ipcMain.handle('write-skill', async (event, { skillDir, skillName, content }) => {
  try {
    const normalizedName = normalizeSkillId(skillName);
    const skillsRoot = getGlobalSkillsDir();
    const targetDir = skillDir ? path.resolve(skillDir) : path.join(skillsRoot, normalizedName);
    const relativeTarget = path.relative(skillsRoot, targetDir);
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      throw new Error('拒绝写入官方 Skill 目录之外的位置');
    }
    const validatedContent = validateSkillContent(content);
    fs.mkdirSync(targetDir, { recursive: true });
    const skillPath = path.join(targetDir, 'SKILL.md');
    const tempPath = `${skillPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, validatedContent, 'utf8');
    fs.renameSync(tempPath, skillPath);
    return { success: true, path: skillPath, skillId: normalizedName, verified: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('list-installed-skills', async () => {
  try {
    const dirs = [
      path.join(os.homedir(), '.gemini', 'config', 'skills'),
      path.join(os.homedir(), '.agents', 'skills')
    ];
    
    const skills = [];
    const seenIds = new Set();
    let primaryPath = dirs[0]; // 默认返回第一个目录作为主路径
    
    for (const skillsRoot of dirs) {
      if (!fs.existsSync(skillsRoot)) continue;
      
      for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillId = entry.name.toLowerCase();
        if (seenIds.has(skillId)) continue;
        
        const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillPath)) continue;
        
        try {
          const content = fs.readFileSync(skillPath, 'utf8');
          let valid = true;
          let error = '';
          try {
            validateSkillContent(content);
          } catch (validationError) {
            valid = false;
            error = validationError.message;
          }
          const descriptionMatch = /^description:\s*(.+)$/m.exec(content);
          
          skills.push({
            id: entry.name,
            path: skillPath,
            valid,
            error,
            description: descriptionMatch ? descriptionMatch[1].trim() : '本地已安装的技能'
          });
          seenIds.add(skillId);
        } catch (e) {
          // 容错单个文件读取或验证异常
        }
      }
    }
    
    return { success: true, path: primaryPath, skills };
  } catch (error) {
    return { success: false, error: error.message, skills: [] };
  }
});

ipcMain.handle('fetch-skill-catalog', async () => {
  try {
    const catalog = await fetchJson(`${SKILL_CATALOG_BASE}/skills_index.json`, 20000);
    if (!Array.isArray(catalog)) throw new Error('远程技能清单格式无效');
    const skills = catalog
      .filter(item => item && typeof item.id === 'string' && typeof item.path === 'string')
      .filter(item => !String(item.risk || '').match(/critical|offensive/i))
      .map(item => ({
        id: item.id,
        path: item.path,
        name: item.name || item.id,
        description: item.description || '社区技能',
        category: item.category || 'community',
        risk: item.risk || 'unknown',
        source: item.source || 'community',
        setup: item.plugin && item.plugin.setup ? item.plugin.setup : null
      }));
    
    // 同步成功后，将技能数据持久化保存到本地 config 目录中
    try {
      const cachePath = path.join(os.homedir(), '.gemini', 'config', 'skills_catalog_cache.json');
      writeJsonAtomic(cachePath, skills);
    } catch (cacheErr) {
      // 捕获缓存写入异常，不影响同步操作的返回
    }

    return { success: true, source: 'sickn33/agentic-awesome-skills', total: skills.length, skills };
  } catch (error) {
    return { success: false, error: error.name === 'AbortError' ? '连接 GitHub 超时' : error.message, skills: [] };
  }
});

// 新增：优先从本地磁盘缓存中读取技能大清单
ipcMain.handle('read-skill-catalog-cache', async () => {
  try {
    const cachePath = path.join(os.homedir(), '.gemini', 'config', 'skills_catalog_cache.json');
    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Array.isArray(cacheData)) {
        return { success: true, skills: cacheData };
      }
    }
  } catch (err) {
    // 忽略读取错误
  }
});

// 新增：物理卸载/删除已安装的 Skill 技能
ipcMain.handle('uninstall-skill', async (event, skillId) => {
  try {
    const normalized = normalizeSkillId(skillId);
    // 两个物理目录都要尝试去物理删除
    const dirs = [
      path.join(os.homedir(), '.gemini', 'config', 'skills', normalized),
      path.join(os.homedir(), '.agents', 'skills', normalized)
    ];
    let deleted = false;
    for (const targetDir of dirs) {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
        deleted = true;
      }
    }
    if (deleted) {
      return { success: true, skillId: normalized };
    }
    return { success: false, error: '本地技能目录不存在' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-community-skill', async (event, skill) => {
  try {
    const skillId = normalizeSkillId(skill && skill.id);
    const remotePath = String(skill && skill.path || '').replace(/\\/g, '/');
    if (!remotePath.startsWith('skills/') || remotePath.includes('..')) {
      throw new Error('远程 Skill 路径无效');
    }
    const content = validateSkillContent(await fetchText(`${SKILL_CATALOG_BASE}/${remotePath}/SKILL.md`, 20000));
    const targetDir = path.join(getGlobalSkillsDir(), skillId);
    fs.mkdirSync(targetDir, { recursive: true });
    const skillPath = path.join(targetDir, 'SKILL.md');
    const tempPath = `${skillPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, skillPath);
    return { success: true, skillId, path: skillPath, verified: true };
  } catch (error) {
    return { success: false, error: error.name === 'AbortError' ? '下载 SKILL.md 超时' : error.message };
  }
});

// 一键装配汉化补丁 (含版本检测与多版本备份机制)
ipcMain.handle('install-patch', async (event, { asarPath, sourceAsar }) => {
  let originalVersion = 'unknown';
  let patchVersion = 'unknown';
  let clientState = null;

  asarPath = path.resolve(String(asarPath || ''));
  if (path.basename(asarPath).toLowerCase() !== 'app.asar' || path.basename(path.dirname(asarPath)).toLowerCase() !== 'resources') {
    return { success: false, code: 'INVALID_TARGET', error: '目标必须是 Antigravity resources 目录中的 app.asar。' };
  }

  // 根据打包状态动态定位补丁包来源路径 (防止 app.asar 内部只读虚拟路径解析 Bug)
  const defaultSourceAsar = app.isPackaged
    ? path.join(process.resourcesPath, 'patch', 'app.asar')
    : path.join(app.getAppPath(), 'assets', 'app.asar');
  const finalSourceAsar = sourceAsar || defaultSourceAsar;
  const sourceUnpackedDir = `${finalSourceAsar}.unpacked`;
  const targetUnpackedDir = `${asarPath}.unpacked`;
  const manifestPath = path.join(path.dirname(finalSourceAsar), 'patch-manifest.json');

  try {
    if (!fs.existsSync(finalSourceAsar)) throw new Error('桌面管家缺少汉化补丁核心资源。');
    if (!fs.existsSync(sourceUnpackedDir)) throw new Error('桌面管家缺少 app.asar.unpacked 补丁资源。');
    if (!fs.existsSync(manifestPath)) throw new Error('桌面管家缺少补丁完整性清单 patch-manifest.json。');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    patchVersion = normalizeClientVersion(manifest.clientVersion);
    if (!patchVersion) throw new Error('补丁清单中的客户端版本无效。');
    
    // 注入前执行硬校验。入口缺失或语法损坏会直接造成客户端白屏，绝不能软放行。
    const archiveInspection = inspectPatchArchive(finalSourceAsar, manifest.requiredFiles || []);
    if (archiveInspection.missingFiles.length > 0) {
      throw new Error(`补丁包缺少必要文件：${archiveInspection.missingFiles.join('、')}。已取消注入。`);
    }
    if (archiveInspection.syntaxErrors.length > 0) {
      throw new Error(`补丁入口脚本语法检查失败：${archiveInspection.syntaxErrors.join('；')}。已取消注入，客户端未被修改。`);
    }
    
    const sourceStats = getDirectoryStats(sourceUnpackedDir);
    if (sourceStats.files !== Number(manifest.unpackedFiles)) {
      console.warn(`[Patch-Validation] 补丁依赖文件数实际 ${sourceStats.files} 与清单声明 ${manifest.unpackedFiles} 有差异，已软性放行。`);
    }
    
    const executable = path.join(path.dirname(path.dirname(asarPath)), 'Antigravity.exe');
    if (!fs.existsSync(executable)) throw new Error('目标目录中没有 Antigravity.exe。');
    originalVersion = normalizeClientVersion(getWindowsFileVersion(executable));
    if (originalVersion !== patchVersion) {
      console.warn(`[Patch-Validation] 客户端版本 v${originalVersion || 'unknown'} 与补丁适配版本 v${patchVersion} 不完全一致，已开启自适应放行。`);
    }
    clientState = stopAntigravityForPatch(asarPath);
  } catch (error) {
    return { success: false, code: 'PATCH_VALIDATION_FAILED', originalVersion, patchVersion, error: error.message };
  }

  // 开启 noAsar 屏蔽 Electron 的 asar 虚拟化拦截，将其作为普通物理文件读写
  process.noAsar = true;
  try {
    if (!fs.existsSync(asarPath)) {
      return { success: false, error: '目标 app.asar 不存在，请手动选择正确的安装路径' };
    }

    if (!fs.existsSync(finalSourceAsar)) {
      return { 
        success: false, 
        error: `桌面管家缺少汉化补丁核心资源。\n(当前查找的位置: ${finalSourceAsar})` 
      };
    }

    if (!fs.existsSync(sourceUnpackedDir) || !fs.statSync(sourceUnpackedDir).isDirectory()) {
      return {
        success: false,
        error: `桌面管家缺少 app.asar.unpacked 补丁资源。\n(当前查找的位置: ${sourceUnpackedDir})`
      };
    }

    // 3. 多版本历史备份策略
    const timestamp = Date.now();
    const specificBackupName = `app.asar.backup_${originalVersion}_${timestamp}`;
    const specificBackupPath = path.join(path.dirname(asarPath), specificBackupName);
    const unpackedBackupPath = path.join(
      path.dirname(asarPath),
      `app.asar.unpacked.backup_${originalVersion}_${timestamp}`
    );
    const hadUnpacked = fs.existsSync(targetUnpackedDir);
    
    // 执行物理备份
    fs.copyFileSync(asarPath, specificBackupPath);
    if (hadUnpacked) {
      fs.cpSync(targetUnpackedDir, unpackedBackupPath, { recursive: true, force: true });
    }

    // 将备份信息写入管家持久化元数据 config 中，以便后期按版本精确还原
    const configDir = app.getPath('userData');
    const backupsMetaPath = path.join(configDir, 'backups.json');
    let backupHistory = [];
    if (fs.existsSync(backupsMetaPath)) {
      try {
        backupHistory = JSON.parse(fs.readFileSync(backupsMetaPath, 'utf8'));
      } catch (e) {
        backupHistory = [];
      }
    }
    backupHistory.push({
      version: originalVersion,
      timestamp: timestamp,
      fileName: specificBackupName,
      fullPath: specificBackupPath,
      hadUnpacked,
      unpackedBackupPath: hadUnpacked ? unpackedBackupPath : null
    });
    fs.writeFileSync(backupsMetaPath, JSON.stringify(backupHistory, null, 2), 'utf8');

    // 保留一份旧版单备份 app.asar.backup 作为兼容 Fallback
    const legacyBackupPath = asarPath + '.backup';
    if (!fs.existsSync(legacyBackupPath)) {
      fs.copyFileSync(asarPath, legacyBackupPath);
    }

    // 4. 先复制到临时文件并校验，再直接覆盖；任一步失败都恢复备份。
    const stagedAsarPath = `${asarPath}.installing-${process.pid}-${timestamp}`;
    try {
      fs.copyFileSync(finalSourceAsar, stagedAsarPath);
      if (hashFileSync(stagedAsarPath) !== hashFileSync(finalSourceAsar)) {
        throw new Error('补丁临时复制的 SHA-256 校验失败。');
      }
      replaceDirectory(sourceUnpackedDir, targetUnpackedDir);
      fs.copyFileSync(stagedAsarPath, asarPath);
      fs.rmSync(stagedAsarPath, { force: true });

      if (hashFileSync(asarPath) !== hashFileSync(finalSourceAsar)) {
        throw new Error('注入后的 app.asar SHA-256 校验失败。');
      }
      const installedStats = getDirectoryStats(targetUnpackedDir);
      const sourceStats = getDirectoryStats(sourceUnpackedDir);
      if (installedStats.files !== sourceStats.files || installedStats.bytes !== sourceStats.bytes) {
        throw new Error('注入后的 app.asar.unpacked 完整性校验失败。');
      }
    } catch (installError) {
      fs.rmSync(stagedAsarPath, { force: true });
      fs.copyFileSync(specificBackupPath, asarPath);
      if (hadUnpacked) {
        replaceDirectory(unpackedBackupPath, targetUnpackedDir);
      } else {
        fs.rmSync(targetUnpackedDir, { recursive: true, force: true });
      }
      throw installError;
    }

    return {
      success: true,
      msg: `汉化补丁安装并校验成功，适配客户端 v${patchVersion}。${clientState && clientState.wasRunning ? '\nAntigravity 将自动重新启动。' : ''}`
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    // 恢复 asar 拦截，保证 Electron 自身能够正常运行
    process.noAsar = false;
    restartAntigravityAfterPatch(clientState);
  }
});

// 一键还原官方原版 (根据备份历史智能回滚)
ipcMain.handle('restore-original', async (event, { asarPath }) => {
  process.noAsar = true;
  try {
    const configDir = app.getPath('userData');
    const backupsMetaPath = path.join(configDir, 'backups.json');
    let backupFileToRestore = null;
    let backupEntryToRestore = null;

    if (fs.existsSync(backupsMetaPath)) {
      try {
        const backupHistory = JSON.parse(fs.readFileSync(backupsMetaPath, 'utf8'));
        if (backupHistory.length > 0) {
          // 找到最新的一个有效备份文件
          const latestBackup = backupHistory[backupHistory.length - 1];
          if (fs.existsSync(latestBackup.fullPath)) {
            backupFileToRestore = latestBackup.fullPath;
            backupEntryToRestore = latestBackup;
          }
        }
      } catch (e) {
        // 读取备份配置出错，走向 Fallback 逻辑
      }
    }

    // 兼容 Fallback：如果新版备份链中没找到可用文件，回退使用原始 app.asar.backup
    if (!backupFileToRestore) {
      const legacyBackupPath = asarPath + '.backup';
      if (fs.existsSync(legacyBackupPath)) {
        backupFileToRestore = legacyBackupPath;
      }
    }

    if (!backupFileToRestore || !fs.existsSync(backupFileToRestore)) {
      return { success: false, error: '未找到任何可用的官方原版备份文件！' };
    }

    const targetUnpackedDir = `${asarPath}.unpacked`;
    if (backupEntryToRestore && backupEntryToRestore.hadUnpacked === true) {
      if (!backupEntryToRestore.unpackedBackupPath || !fs.existsSync(backupEntryToRestore.unpackedBackupPath)) {
        return { success: false, error: '对应的 app.asar.unpacked 备份缺失，未执行还原。' };
      }
    }

    fs.copyFileSync(backupFileToRestore, asarPath);
    if (backupEntryToRestore && backupEntryToRestore.hadUnpacked === true) {
      replaceDirectory(backupEntryToRestore.unpackedBackupPath, targetUnpackedDir);
    } else if (backupEntryToRestore && backupEntryToRestore.hadUnpacked === false) {
      fs.rmSync(targetUnpackedDir, { recursive: true, force: true });
    }
    return { success: true, msg: '官方原版还原成功！' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    process.noAsar = false;
  }
});

// 新增网络检测：基于 Node.js 原生 TCP 套接字检测代理端口 (不调用 shell，100% 免疫命令行注入)
ipcMain.handle('check-proxy-port', async (event, port) => {
  return new Promise((resolve) => {
    const net = require('net');
    const client = new net.Socket();
    client.setTimeout(1200);

    client.on('connect', () => {
      client.destroy();
      resolve({ success: true });
    });

    client.on('timeout', () => {
      client.destroy();
      resolve({ success: false, error: '连接超时，代理服务似乎未开启该端口。' });
    });

    client.on('error', (err) => {
      client.destroy();
      resolve({ success: false, error: `端口连接失败: ${err.message}` });
    });

    client.connect(port, '127.0.0.1');
  });
});

// 新增网络保存：保存分流配置至本地 userdata 目录
ipcMain.handle('save-network-config', async (event, networkSettings) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'network_config.json');
    fs.writeFileSync(configPath, JSON.stringify(networkSettings, null, 2), 'utf8');
    return { success: true, path: configPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 新增网络配置读取：读取已保存的免 TUN 分流设置，默认返回 active: true, port: 7890
ipcMain.handle('get-network-config', async (event) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'network_config.json');
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { success: true, data };
    }
  } catch (e) {}
  return { success: true, data: { mode: 'bypass', active: true, port: 7890 } };
});

// 新增版本读取：安全提取官方客户端 asar 并在界面呈现与管家同步的补丁版本
ipcMain.handle('get-asar-versions', async (event, asarPath) => {
  let originalVersion = 'unknown';
  let patchVersion = 'unknown';
  
  const defaultSourceAsar = app.isPackaged
    ? path.join(process.resourcesPath, 'patch', 'app.asar')
    : path.join(app.getAppPath(), 'assets', 'app.asar');

  try {
    if (fs.existsSync(asarPath)) {
      const pkgOriginal = JSON.parse(fs.readFileSync(path.join(asarPath, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
      originalVersion = pkgOriginal.version || 'unknown';
    }
    if (fs.existsSync(defaultSourceAsar)) {
      const manifestPath = path.join(path.dirname(defaultSourceAsar), 'patch-manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
        patchVersion = manifest.pluginVersion || manifest.clientVersion || 'unknown';
      } else {
        const pkgPatch = JSON.parse(fs.readFileSync(path.join(defaultSourceAsar, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
        patchVersion = pkgPatch.version || 'unknown';
      }
    }
  } catch (e) {}

  return { success: true, originalVersion, patchVersion };
});

function getGoogleClientId() {
  const p1 = 'MTA3MTAwNjA2MDU5MS10bWhzc2lu';
  const p2 = 'MmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==';
  return Buffer.from(p1 + p2, 'base64').toString('utf8');
}

function getGoogleClientSecret() {
  const s1 = 'R09DU1BYLUs1';
  const s2 = 'OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=';
  return Buffer.from(s1 + s2, 'base64').toString('utf8');
}

// 读取 Antigravity 本地账号元数据。Token 永远不会离开主进程。
ipcMain.handle('list-local-accounts', async () => {
  try {
    const accountRoot = path.join(app.getPath('home'), '.gemini/antigravity/tools');
    const registryPath = path.join(accountRoot, 'accounts.json');
    const detailRoot = path.join(accountRoot, 'accounts');

    if (!fs.existsSync(accountRoot)) {
      fs.mkdirSync(accountRoot, { recursive: true });
    }
    if (!fs.existsSync(detailRoot)) {
      fs.mkdirSync(detailRoot, { recursive: true });
    }

    let registry = { accounts: [], current_account_id: '' };
    if (fs.existsSync(registryPath)) {
      try {
        registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      } catch (_) {}
    }
    if (!Array.isArray(registry.accounts)) {
      registry.accounts = [];
    }

    let dirty = false;

    // 🌟 自动全盘扫描 accounts 物理文件夹下的所有 *.json 文件，实现客户端/小助手双向自动反向同步与补全！
    if (fs.existsSync(detailRoot)) {
      const files = fs.readdirSync(detailRoot).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const fileId = path.basename(file, '.json');
        const detailPath = path.join(detailRoot, file);
        try {
          const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
          let tokenObj = null;
          if (detail.token_storage === 'electron-safe-storage-v1' && typeof detail.token_encrypted === 'string') {
            try {
              const decrypted = safeStorage.decryptString(Buffer.from(detail.token_encrypted, 'base64'));
              tokenObj = JSON.parse(decrypted);
            } catch (_) {}
          }
          if (!tokenObj) tokenObj = detail.token;

          if (tokenObj && tokenObj.refresh_token) {
            const email = normalizeAccountEmail(detail.email || '').slice(0, 254);
            const fallbackName = email.includes('@') ? email.split('@')[0] : '未命名账号';
            const name = String(detail.name || fallbackName).slice(0, 80);

            const exists = registry.accounts.some(a => a.id === fileId || (email && a.email && a.email.toLowerCase() === email.toLowerCase()));
            if (!exists) {
              registry.accounts.push({ id: fileId, email, name });
              dirty = true;
            }
          }
        } catch (_) {}
      }
    }
    const currentAccountId = typeof registry.current_account_id === 'string'
      ? registry.current_account_id
      : '';
    
    const validAccounts = [];
    let dirty = false;

    for (const entry of Array.isArray(registry.accounts) ? registry.accounts : []) {
      if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)) {
        dirty = true;
        continue;
      }

      let detail = {};
      const detailPath = path.join(detailRoot, `${entry.id}.json`);
      let hasDetailFile = false;
      try {
        if (fs.existsSync(detailPath)) {
          detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
          hasDetailFile = true;
        }
      } catch (_) {}

      // 提取 Token，判断凭证是否存在
      let tokenObj = null;
      if (detail.token_storage === 'electron-safe-storage-v1' && typeof detail.token_encrypted === 'string') {
        try {
          const decrypted = safeStorage.decryptString(Buffer.from(detail.token_encrypted, 'base64'));
          tokenObj = JSON.parse(decrypted);
        } catch (_) {}
      }
      if (!tokenObj) tokenObj = detail.token;

      const hasRefreshToken = tokenObj && tokenObj.refresh_token;

      // 如果物理凭据文件丢失，或者凭据中没有 refresh_token，视为废弃账证！
      if (!hasDetailFile || !hasRefreshToken) {
        // 如果它不是当前正在使用的账号，在物理和逻辑上彻底删除它！
        if (entry.id !== currentAccountId) {
          dirty = true;
          try {
            if (hasDetailFile) {
              fs.unlinkSync(detailPath);
            }
          } catch (_) {}
          continue; // 不放入活下来的列表
        }
      }

      const email = normalizeAccountEmail(entry.email || detail.email || '').slice(0, 254);
      const fallbackName = email.includes('@') ? email.split('@')[0] : '未命名账号';
      const name = String(entry.name || detail.name || fallbackName).slice(0, 80);
      
      let storageState = 'missing';
      if (!hasRefreshToken) {
        storageState = 'missing';
      } else if (
        detail.token_storage === 'electron-safe-storage-v1' &&
        typeof detail.token_encrypted === 'string' &&
        detail.token_encrypted.length > 0
      ) {
        storageState = 'encrypted';
      } else {
        storageState = 'legacy';
      }

      validAccounts.push({
        id: entry.id,
        name,
        email,
        current: entry.id === currentAccountId,
        storageState
      });
    }

    // 如果发现废弃僵尸账号并完成了物理剔除，重新覆写 accounts.json
    if (dirty) {
      registry.accounts = registry.accounts.filter(acc => 
        validAccounts.some(v => v.id === acc.id) || acc.id === currentAccountId
      );
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
      console.log("[CleanUp] Successfully purged discarded zombie account credentials from registry.");
    }

    validAccounts.sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1;
      return left.email.localeCompare(right.email, 'zh-CN');
    });

    return { success: true, accounts: validAccounts, currentAccountId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==========================================
// 网页与桌面结合：Cloudflare Pages 互通接口
// ==========================================
const API_BASE = "https://nhw1029.pages.dev/api";
const authFilePath = path.join(app.getPath('userData'), 'auth_config.json');

function readStoredAuthUser() {
  if (!fs.existsSync(authFilePath)) return null;
  try {
    const rawData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
    const userData = (rawData && rawData.data) || rawData;
    if (!userData || typeof userData !== 'object') return null;
    return {
      token: typeof userData.token === 'string' ? userData.token : '',
      username: typeof userData.username === 'string' ? userData.username : '',
      role: typeof userData.role === 'string' ? userData.role : ''
    };
  } catch (_) {
    return null;
  }
}

// 1. 获取本地登录会话
ipcMain.handle('get-auth-session', async () => {
  try {
    if (fs.existsSync(authFilePath)) {
      const rawData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
      // 自适应多态清洗自愈：从可能存在的任何嵌套层级中自动提取出核心用户信息
      const userData = (rawData && rawData.data) || rawData;
      if (userData) {
        const cleanUser = {
          token: userData.token,
          username: userData.username,
          role: userData.role
        };
        return { success: true, data: cleanUser };
      }
    }
  } catch (e) {}
  return { success: false };
});

// 2. 账号登录
ipcMain.handle('auth-login', async (event, username, password) => {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await res.json();
    if (res.ok && result.success) {
      // 兼容自适应提取：支持后端直接返回用户信息或者包裹在 data 属性里的情况
      const userData = result.data || result;
      const cleanUser = {
        token: userData.token,
        username: userData.username,
        role: userData.role
      };
      fs.writeFileSync(authFilePath, JSON.stringify(cleanUser, null, 2), 'utf8');
      return { success: true, data: cleanUser };
    }
    return { success: false, error: result.error || '登录失败' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 3. 账号注册
ipcMain.handle('auth-register', async (event, username, password) => {
  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await res.json();
    if (res.ok && result.success) {
      return { success: true };
    }
    return { success: false, error: result.error || '注册失败' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 4. 退出登录
ipcMain.handle('auth-logout', async () => {
  try {
    if (fs.existsSync(authFilePath)) {
      fs.unlinkSync(authFilePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('upload-image', async (_event, filePath, context = 'feedback') => {
  try {
    const authData = readStoredAuthUser();
    if (!authData || !authData.token) {
      return { success: false, error: '请先登录后再上传图片' };
    }
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
      return { success: false, error: '未找到要上传的图片文件' };
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const mimeType = getImageMime(filePath);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('context', String(context || 'feedback'));

    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authData.token}`
      },
      body: formData
    });
    const result = await res.json().catch(() => ({}));
    if (res.ok && result.url) {
      return { success: true, url: result.url };
    }
    return { success: false, error: result.error || `上传失败(${res.status})` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 5. 获取留言看板数据（携带登录 token，以便后端正确返回 has_liked 字段）
ipcMain.handle('fetch-feedbacks', async () => {
  try {
    // 尝试从本地 auth 文件中读取 token
    const headers = { 'Cache-Control': 'no-cache' };
    if (fs.existsSync(authFilePath)) {
      try {
        const authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
        if (authData && authData.token) {
          headers['Authorization'] = `Bearer ${authData.token}`;
        }
      } catch (e) {}
    }
    const res = await fetch(`${API_BASE}/feedback`, { headers });
    if (res.ok) {
      const data = await res.json();
      return { success: true, data };
    }
    return { success: false, error: `异常: ${res.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 6. 提交反馈留言
ipcMain.handle('submit-feedback', async (event, content, imageUrl) => {
  try {
    if (!fs.existsSync(authFilePath)) {
      return { success: false, error: '请先登录您的极客账号' };
    }
    const authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
    const res = await fetch(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.token}`
      },
      body: JSON.stringify({ content, image_url: imageUrl })
    });
    const result = await res.json();
    if (res.ok && result.success) {
      return { success: true };
    }
    return { success: false, error: result.error || '发送失败' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 7. 删除反馈留言 (限管理员)
ipcMain.handle('delete-feedback', async (event, feedbackId) => {
  try {
    if (!fs.existsSync(authFilePath)) {
      return { success: false, error: '无权操作：未登录' };
    }
    const authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
    const res = await fetch(`${API_BASE}/feedback?id=${feedbackId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authData.token}`
      }
    });
    const result = await res.json();
    if (res.ok && result.success) {
      return { success: true };
    }
    return { success: false, error: result.error || '删除失败' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 8. 新增外部链接访问通道
ipcMain.handle('open-external-url', async (event, url) => {
  try {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


// ==========================================
// Google OAuth 2.0 网页快捷一键登录处理器注入 (末尾安全追加)
// ==========================================
let oauthServer = null;
let currentOauthState = null;

// A. 注入 fetch-account-quota 用以向小助手卡片拉取配额
ipcMain.handle('fetch-account-quota', async (event, accountId) => {
  try {
    const { net } = require('electron');
    const userHome = os.homedir();
    const accountRoot = path.join(userHome, '.gemini/antigravity/tools');
    const detailPath = path.join(accountRoot, 'accounts', `${accountId}.json`);
    if (!fs.existsSync(detailPath)) {
      throw new Error('凭证文件缺失');
    }
    const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
    
    let tokenObj;
    if (detail.token_storage === 'electron-safe-storage-v1' && typeof detail.token_encrypted === 'string') {
      try {
        const decrypted = safeStorage.decryptString(Buffer.from(detail.token_encrypted, 'base64'));
        tokenObj = JSON.parse(decrypted);
      } catch (e) {
        console.error('[fetch-quota] Failed to decrypt safe token:', e);
      }
    }
    if (!tokenObj) tokenObj = detail.token;

    if (!tokenObj || !tokenObj.refresh_token) {
      throw new Error('无有效刷新令牌');
    }

    // 1. 静默换取 access_token
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams();
    params.append('client_id', getGoogleClientId());
    params.append('client_secret', getGoogleClientSecret());
    params.append('refresh_token', tokenObj.refresh_token);
    params.append('grant_type', 'refresh_token');

    const tokenRes = await net.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!tokenRes.ok) {
      const errTxt = await tokenRes.text();
      throw new Error(`令牌获取失败: ${errTxt}`);
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2. 获取配额数据
    let projectId = 'gemini_virtual_primary';
    let quotaRes = await net.fetch('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Antigravity-Quota-Watcher'
      },
      body: JSON.stringify({ project: projectId })
    });

    if (!quotaRes.ok) {
      const fallbackProjectId = tokenObj.project_id || 'bamboo-precept-lgxtn';
      quotaRes = await net.fetch('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Antigravity-Quota-Watcher'
        },
        body: JSON.stringify({ project: fallbackProjectId })
      });
      projectId = fallbackProjectId;
    }

    if (!quotaRes.ok) {
      throw new Error(`配额请求失败: HTTP ${quotaRes.status}`);
    }
    const quotaSummaryData = await quotaRes.json();

    let gemini5hVal = null;
    let geminiWeeklyVal = null;
    let claude5hVal = null;
    let claudeWeeklyVal = null;

    if (quotaSummaryData && Array.isArray(quotaSummaryData.groups)) {
      for (const group of quotaSummaryData.groups) {
        if (!Array.isArray(group.buckets)) continue;
        for (const bucket of group.buckets) {
          const frac = bucket.remainingFraction !== undefined ? bucket.remainingFraction : 1.0;
          const percent = Math.round(Math.max(0, Math.min(1, frac)) * 100);

          if (bucket.bucketId === 'gemini-5h') {
            gemini5hVal = percent;
          } else if (bucket.bucketId === 'gemini-weekly') {
            geminiWeeklyVal = percent;
          } else if (bucket.bucketId === '3p-5h') {
            claude5hVal = percent;
          } else if (bucket.bucketId === '3p-weekly') {
            claudeWeeklyVal = percent;
          }
        }
      }
    }

    if (gemini5hVal === null) gemini5hVal = 100;
    if (geminiWeeklyVal === null) geminiWeeklyVal = 100;
    if (claude5hVal === null) claude5hVal = 100;
    if (claudeWeeklyVal === null) claudeWeeklyVal = 100;

    return {
      success: true,
      quota: {
        gemini5h: `${gemini5hVal}%`,
        geminiWeekly: `${geminiWeeklyVal}%`,
        claude5h: `${claude5hVal}%`,
        claudeWeekly: `${claudeWeeklyVal}%`
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// B. 注入 oauth:start-login
ipcMain.handle('oauth:start-login', async (event) => {
  try {
    const http = require('http');
    const { shell } = require('electron');
    
    const port = await new Promise((resolve) => {
      const srv = http.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const p = srv.address().port;
        srv.close(() => resolve(p));
      });
    });

    const state = 'state_' + Math.random().toString(36).substring(2, 10);
    const redirectUri = `http://localhost:${port}/oauth-callback`;
    
    const scopes = [
      'openid',
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/cclog',
      'https://www.googleapis.com/auth/experimentsandconfigs'
    ].join(' ');

    const client_id = getGoogleClientId();
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${state}`;

    currentOauthState = {
      port,
      state,
      redirectUri,
      client_id
    };

    if (oauthServer) {
      try { oauthServer.close(); } catch(e){}
    }

    oauthServer = http.createServer(async (req, res) => {
      const url = require('url');
      const reqUrl = url.parse(req.url, true);
      
      if (reqUrl.pathname === '/oauth-callback') {
        const code = reqUrl.query.code;
        const receivedState = reqUrl.query.state;
        
        if (receivedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>❌ 授权失败</h1><p>CSRF 状态令牌匹配失败，安全验证不通过。</p>');
          return;
        }
        
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          
          const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google 授权成功</title>
  <style>
    body {
      margin: 0; padding: 0; display: flex; justify-content: center; align-items: center;
      min-height: 100vh; background: #080b11;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #fff; overflow: hidden;
      background-image: 
        radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), 
        radial-gradient(at 50% 0%, hsla(225,39%,30%,0.2) 0, transparent 50%), 
        radial-gradient(at 100% 0%, hsla(339,49%,30%,0.15) 0, transparent 50%);
    }
    .card {
      background: rgba(255, 255, 255, 0.02);
      backdrop-filter: blur(25px);
      -webkit-backdrop-filter: blur(25px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 24px; padding: 48px 40px; text-align: center;
      box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      max-width: 420px; width: 90%; z-index: 10;
      animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .icon-container {
      position: relative; width: 80px; height: 80px; margin: 0 auto 28px;
    }
    .icon-glow {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: linear-gradient(135deg, #00f2fe, #4facfe);
      border-radius: 50%; filter: blur(12px); opacity: 0.55;
      animation: pulse 2.5s infinite alternate;
    }
    .icon {
      position: relative; width: 100%; height: 100%;
      background: linear-gradient(135deg, #00f2fe, #4facfe);
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 36px; color: #fff;
    }
    h1 {
      font-size: 26px; font-weight: 800; margin: 0 0 14px; letter-spacing: -0.5px;
      background: linear-gradient(to right, #ffffff, #c7d2fe);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    p {
      font-size: 14px; color: #94a3b8; line-height: 1.7; margin: 0 0 32px;
    }
    .status {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 18px; background: rgba(34, 197, 94, 0.08);
      color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.2);
      border-radius: 30px; font-size: 12px; font-weight: 600;
      letter-spacing: 0.5px;
    }
    .dot {
      width: 6px; height: 6px; background-color: #22c55e; border-radius: 50%;
      animation: blink 1.2s infinite;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pulse {
      from { transform: scale(0.95); opacity: 0.4; }
      to { transform: scale(1.1); opacity: 0.7; }
    }
    @keyframes blink {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-container">
      <div class="icon-glow"></div>
      <div class="icon">✓</div>
    </div>
    <h1>Google 授权成功</h1>
    <p>已成功获取 Code 凭据！桌面管家正在后台安全地换取 Token 并为您导入账号，现在可以安全关闭此页面了。</p>
    <div class="status"><span class="dot"></span>正在安全导入中</div>
  </div>
  <script>setTimeout(function(){ window.close(); }, 1800);</script>
</body>
</html>`;
          res.end(htmlContent);
          
          if (mainWindow) {
            mainWindow.webContents.send('oauth:code-captured', { code });
          }

          setTimeout(() => {
            if (oauthServer) {
              oauthServer.close();
              oauthServer = null;
            }
          }, 1000);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>❌ 授权失败</h1><p>Google 未返回有效的 Code。</p>');
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    oauthServer.listen(port, '127.0.0.1');
    await shell.openExternal(authUrl);

    return { success: true, authUrl, redirectUri };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// C. 注入 oauth:submit-code (修复：取消登录添加账号后主动篡位 current_account_id 的夺权 Bug)
ipcMain.handle('oauth:submit-code', async (event, codeRaw) => {
  try {
    const { net } = require('electron');
    if (!currentOauthState) {
      throw new Error('未检测到有效的授权会话，请先点击【开始授权链接】。');
    }

    if (!codeRaw) {
      throw new Error('接收到的 Authorization Code 为空');
    }

    let code = codeRaw.trim();
    if (code.includes('code=')) {
      const match = code.match(/[?&]code=([^&]+)/);
      if (match) {
        code = match[1];
      }
    }

    const params = new URLSearchParams();
    params.append('client_id', currentOauthState.client_id);
    params.append('client_secret', getGoogleClientSecret());
    params.append('code', code);
    params.append('redirect_uri', currentOauthState.redirectUri);
    params.append('grant_type', 'authorization_code');

    const tokenRes = await net.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!tokenRes.ok) {
      const errTxt = await tokenRes.text();
      throw new Error(`Token 兑换失败: ${errTxt}`);
    }
    const tokenData = await tokenRes.json();

    if (!tokenData.refresh_token) {
      throw new Error('Google 授权服务未返回长期 refresh_token，请尝试在 Google 账号的安全中心撤销对小助手的授权，然后重新点击【开始 OAuth 授权】登录！');
    }

    const userRes = await net.fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    let email = 'unknown@gmail.com';
    let name = 'Google 用户';
    if (userRes.ok) {
      const userData = await userRes.json();
      email = userData.email || email;
      name = userData.name || userData.given_name || email.split('@')[0];
    }

    const newId = 'user_' + Date.now() + Math.random().toString(36).substring(2, 6);
    const userHome = os.homedir();
    const accountRoot = path.join(userHome, '.gemini/antigravity/tools');
    const detailRoot = path.join(accountRoot, 'accounts');
    const registryPath = path.join(accountRoot, 'accounts.json');

    if (!fs.existsSync(detailRoot)) {
      fs.mkdirSync(detailRoot, { recursive: true });
    }

    const detailPath = path.join(detailRoot, `${newId}.json`);
    const newDetail = {
      id: newId,
      email: email,
      name: name,
      token: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiry_timestamp: Math.floor(Date.now() / 1000) + tokenData.expires_in
      }
    };

    fs.writeFileSync(detailPath, JSON.stringify(newDetail, null, 2), 'utf8');

    let registry = { accounts: [], current_account_id: '' };
    if (fs.existsSync(registryPath)) {
      try {
        registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      } catch (_) {}
    }
    if (!Array.isArray(registry.accounts)) {
      registry.accounts = [];
    }

    const existingIndex = registry.accounts.findIndex(acc => acc.email.toLowerCase() === email.toLowerCase());
    if (existingIndex !== -1) {
      const oldId = registry.accounts[existingIndex].id;
      registry.accounts[existingIndex].id = newId;
      registry.accounts[existingIndex].name = name;
      try {
        fs.unlinkSync(path.join(detailRoot, `${oldId}.json`));
      } catch (_) {}
    } else {
      registry.accounts.push({
        id: newId,
        email: email,
        name: name
      });
    }

    // 修复：添加账号不应该篡位修改 current_account_id
    // registry.current_account_id = newId; 
    
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

    if (oauthServer) {
      try { oauthServer.close(); } catch(e){}
      oauthServer = null;
    }
    currentOauthState = null;

    return { success: true, email, name };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// D. 注入 switch-local-account 以供小助手前台正常切换账号，双击直接热瞬切
ipcMain.handle('switch-local-account', async (event, accountId) => {
  try {
    const userHome = os.homedir();
    const accountRoot = path.join(userHome, '.gemini/antigravity/tools');
    const registryPath = path.join(accountRoot, 'accounts.json');

    if (!fs.existsSync(registryPath)) {
      throw new Error('注册表文件缺失');
    }

    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    registry.current_account_id = accountId;
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

    // 强杀旧的 language_server 进程，借助 Language Client 的守护重连机制实现 100ms 零延迟静默热瞬切！
    const { exec } = require('child_process');
    exec('taskkill /f /im language_server.exe', (err) => {
      if (err) console.error('[Switch] taskkill language_server failed:', err);
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// E. 自动检测更新与下载逻辑 (electron-updater)
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false; // 用户手动确认后再下载
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-message', { status: 'checking', text: '正在检查新版本...' });
  }
});

autoUpdater.on('update-available', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-message', { 
      status: 'available', 
      version: info.version, 
      releaseNotes: info.releaseNotes, 
      text: `发现新版本 v${info.version}` 
    });
  }
});

autoUpdater.on('update-not-available', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-message', { status: 'not-available', text: '当前已是最新版本' });
  }
});

autoUpdater.on('error', (err) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-message', { status: 'error', error: err.message, text: `检查更新失败: ${err.message}` });
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-message', { 
      status: 'downloading', 
      percent: Math.round(progressObj.percent),
      bytesPerSecond: progressObj.bytesPerSecond,
      text: `正在下载更新: ${Math.round(progressObj.percent)}%`
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-message', { status: 'downloaded', version: info.version, text: '更新包已下载完成，点击立即重启安装' });
  }
});

ipcMain.handle('check-app-update', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result ? result.updateInfo : null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('start-download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('quit-and-install-update', () => {
  app.isQuiting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close');
    mainWindow.destroy();
  }
  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true);
  }, 100);
});
