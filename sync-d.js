const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(msg, type = 'info') {
  const colors = { info: '\x1b[36m', success: '\x1b[32m', error: '\x1b[31m', reset: '\x1b[0m' };
  console.log(`${colors[type] || ''}${msg}${colors.reset}`);
}

// 移除在同步时对管家和助手客户端的强杀进程逻辑，改为由用户自主点按注入，防止管家运行中突然退出
try {
  const srcRes = path.join(__dirname, 'dist', 'win-unpacked', 'resources');
const destRes = 'D:/ang/agy-hub/resources';

  if (!fs.existsSync(srcRes)) {
    throw new Error(`未找到构建后的源资源目录: ${srcRes}`);
  }

  log(`[*] 正在同步资源: ${srcRes} ➔ ${destRes}...`);

  function copyFolderRecursiveSync(source, target) {
    let files = [];
    const targetFolder = path.join(target, path.basename(source));
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }
    if (fs.lstatSync(source).isDirectory()) {
      files = fs.readdirSync(source);
      files.forEach((file) => {
        const curSource = path.join(source, file);
        if (fs.lstatSync(curSource).isDirectory()) {
          copyFolderRecursiveSync(curSource, targetFolder);
        } else {
          try {
            fs.copyFileSync(curSource, path.join(targetFolder, file));
          } catch (e) {
            log(`[!] 无法覆盖文件 ${file} (可能被只读锁定)，跳过: ${e.message}`, 'info');
          }
        }
      });
    }
  }

  if (fs.existsSync(srcRes)) {
    const items = fs.readdirSync(srcRes);
    items.forEach(item => {
      const srcPath = path.join(srcRes, item);
      const destPath = path.join(destRes, item);
      if (fs.lstatSync(srcPath).isDirectory()) {
        copyFolderRecursiveSync(srcPath, destRes);
      } else {
        try {
          fs.copyFileSync(srcPath, destPath);
        } catch (e) {
          log(`[!] 无法覆盖根资源 ${item}，跳过: ${e.message}`, 'info');
        }
      }
    });
    log('[SUCCESS] 管家主程序与汉化补丁已成功热覆盖同步至 D:/ang/agy-hub/ 运行目录下！', 'success');
  }
} catch (err) {
  log(`[ERROR] 同步失败: ${err.message}`, 'error');
  process.exit(1);
}
