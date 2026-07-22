# Antigravity 主题资源安全边界

## 壁纸任务

当用户只要求新增、替换或调整壁纸时：

- 只允许修改对应主题图片、主题清单中的图片文件名/定位参数，以及用户主题配置。
- 禁止修改 `preload.js`、`ipcHandlers.js`、`main.js`、`accountVault.js` 和其他运行时代码。
- 禁止为了单纯换图执行字符串拼接、脚本合并或重新生成 JavaScript 文件。
- 禁止直接覆盖客户端或 AGY Hub 的 `app.asar`。
- 先在外部稳定主题目录和运行时主题缓存中验证图片，再由专门的发布流程更新安装资源。

## 发布门禁

只有用户明确要求发布或重新打包插件时，才允许更新 ASAR。发布前必须：

1. 对 `dist/main.js`、`dist/preload.js`、`dist/ipcHandlers.js` 运行 `node --check`。
2. 确认补丁包包含 `dist/accountVault.js`。
3. 比较源码包、构建包、D 盘注入包的 SHA-256。
4. 保留上一份已验收 ASAR，失败时自动回滚。

任何一步失败都必须停止，不能软放行或覆盖客户端。
