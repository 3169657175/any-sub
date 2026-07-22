# AGY Hub 补丁工作台说明书

这套工作台用于安全维护 AGY Hub 的 Antigravity 一键注入源包。它把“已经验证可用的完整补丁”和“以后经常变化的汉化/小型注入”分开，避免 AI 为补几句汉化而重写整个 `dist/preload.js`，再次造成白屏、快捷登录失效或注入包缺文件。

## 一、目录作用

- `../assets/app.asar`：AGY Hub 当前一键注入使用的源包。
- `../assets/app.asar.baseline_stable`：已经验证可用的冻结基线，不参与日常编辑。
- `baseline-meta.json`：基线的创建时间、大小和 SHA-256。
- `translation-rules.json`：日常补充汉化的位置。
- `runtime-rules.json`：对受控运行文件执行带匹配次数校验的精确替换。
- `injections/preload-header.js`：需要放在 `preload.js` 开头的少量代码，通常保持空白。
- `injections/preload-footer.js`：需要放在 `preload.js` 末尾的少量代码，通常保持空白。
- `build-patch.js`：从冻结基线重新生成 `assets/app.asar`。
- `verify-patch.js`：检查源包结构、必要文件和 JavaScript 语法。
- `last-build-report.json`：最近一次重建报告。
- `last-verify-report.json`：最近一次验收报告。

## 二、当前安全状态

当前已经建立稳定基线。默认汉化规则全部关闭，头部和尾部注入文件为空，因此执行重建后，`dist/preload.js` 应与稳定基线保持相同哈希，不会偷偷改变运行逻辑。

不要为了“保险”反复执行 `npm.cmd run patch:baseline`。该命令会用当前 `assets/app.asar` 覆盖稳定基线，只应在当前补丁已经完整测试通过、准备正式升级基线时使用。

## 三、日常补充汉化

只编辑 `translation-rules.json`，每条规则使用精确文本替换：

```json
[
  {
    "description": "翻译设置按钮",
    "find": "Settings",
    "replace": "设置",
    "enabled": true
  }
]
```

注意事项：

1. `find` 必须是源代码中真实存在的完整文本，不能留空。
2. 脚本会替换所有完全相同的匹配项，先确认同一英文在其他位置是否具有不同含义。
3. 没准备启用的规则设置为 `"enabled": false`。
4. 如果规则一个匹配都没有，构建会直接失败，不会生成一个看似成功但实际无效的包。
5. 纯汉化任务不要编辑 `preload-header.js`、`preload-footer.js` 或完整 ASAR。

## 四、安全重建与验收

在项目目录 `C:\Users\niu\.gemini\antigravity\scratch\agy-hub` 中依次执行：

```powershell
npm.cmd run patch:rebuild
npm.cmd run patch:verify
```

`patch:rebuild` 会执行以下工作：

1. 解开冻结基线。
2. 应用启用的汉化规则。
3. 应用可选的头部/尾部注入。
4. 对生成的 `dist/preload.js` 做语法检查。
5. 重新打包为 `assets/app.asar`。
6. 写入 `last-build-report.json` 并清理系统临时文件。

`patch:verify` 会确认以下文件存在：

- `package.json`
- `dist/languageServer.js`
- `dist/preload.js`
- `dist/main.js`
- `dist/ipcHandlers.js`
- `dist/accountVault.js`

同时会检查五个运行时 JavaScript 文件的语法，并确认模型 API 使用 31000、Cloud Code 使用 31001、官方接口回退存在、Token 上报使用 IPC。只有输出中出现 `"ok": true`，才进入一键注入测试。

当前还会检查 Antigravity 本地账号弹窗使用 `daily-cloudcode-pa.googleapis.com` 查询额度，并阻止“字段缺失时显示 100%”的旧逻辑重新进入补丁包。

## 五、一键注入测试顺序

1. 完全退出 Antigravity。
2. 打开 AGY Hub，执行一键注入。
3. 启动 Antigravity，先确认不白屏。
4. 测试登录、快捷切换账号、额度、本地账号、汉化界面等核心功能。
5. 再测试本次新增的汉化或注入内容。
6. 确认全部正常后，才构建或同步新的 AGY Hub 安装包。

本地发布命令：

```powershell
npm.cmd run dist:sync
```

当前 `sync-d.js` 会把构建资源同步到 `D:\ang\agy-hub\resources`，这是本机 AGY Hub 的运行目录，不是 Antigravity 的下载目录，也不是适用于所有电脑的通用路径。发布给其他用户时，应让安装包携带 `assets/app.asar`，不要让用户依赖这条本机路径。

## 六、失败时如何恢复

如果新增规则后出现白屏或功能异常：

1. 把刚新增规则的 `enabled` 改为 `false`。
2. 清空本次写入的 `preload-header.js` 或 `preload-footer.js` 内容。
3. 重新执行：

```powershell
npm.cmd run patch:rebuild
npm.cmd run patch:verify
```

因为每次都是从 `app.asar.baseline_stable` 重新生成，所以禁用新增层后即可回到稳定源包，不需要手工修改完整 `preload.js`。

## 七、常见报错

### `package.json was not found in this archive`

说明拿去注入的不是完整 Electron ASAR，或打包时目录层级错误。运行 `npm.cmd run patch:verify`，不要继续注入。

### `补丁包缺少必要文件: dist/accountVault.js`

说明源包不完整，账号功能也可能随之失效。工作台验收会直接拦截这种包。

### 注入后 Antigravity 白屏

优先检查最近的头部/尾部注入。语法正确不代表运行时逻辑一定正确，因此新增运行逻辑必须逐项测试，不能和大量汉化同时提交。

### 重建成功但汉化没有变化

检查对应规则是否设置为 `"enabled": true`，并查看 `last-build-report.json` 中的 `appliedRules` 和 `hits`。

### 只有重启后某项数据才更新

这通常是事件监听或进程间通信问题，不是文本汉化问题。不要用翻译规则修改这类功能，应单独定位运行逻辑并通过小型注入测试。

## 八、给 AI 的安全指令模板

补汉化时：

> 只修改 `patch-workbench/translation-rules.json`，不要编辑 `assets/app.asar`、完整 `dist/preload.js` 或其他运行时逻辑。修改后执行 `npm.cmd run patch:rebuild` 和 `npm.cmd run patch:verify`。

增加小型运行逻辑时：

> 先分析稳定基线中现有接口，只把最小独立代码写入 `patch-workbench/injections/preload-footer.js`。不要重写原始 `preload.js`。重建和验收后列出风险与测试结果。

升级稳定基线时：

> 当前 `assets/app.asar` 已经人工确认所有功能正常。先备份现有 `app.asar.baseline_stable`，再执行 `npm.cmd run patch:baseline`，随后执行一次无规则重建和验收，确认重建前后 preload 哈希一致。

## 九、明确禁止事项

- 不让 AI 直接批量改写 `assets/app.asar`。
- 不让 AI 为补汉化而重新生成整个 `dist/preload.js`。
- 不把汉化、账号、代理、Token 监控等多类改动混在一次注入中。
- 不在未验收时覆盖稳定基线。
- 不在 `patch:verify` 失败后继续注入或发布安装包。

这套流程的核心很简单：稳定包冻结，小改动分层，生成后强制验收，出问题就关闭新增层回到基线。

## 十、额度数据来源

AGY Hub 查询额度时必须优先使用 `daily-cloudcode-pa.googleapis.com`，它与 Antigravity 2.3.1 当前使用的 Cloud Code 服务一致。旧域名 `cloudcode-pa.googleapis.com` 只作为网络故障回退；在 Gemini 3.6 Flash 更新后，旧域名可能继续返回更新前的额度体系。

额度解析失败时不得默认显示 `100%`。当前实现会显示查询失败，并在终端记录实际数据源，避免把“没有读到数据”误报为“额度充足”。

## 十一、Token 与缓存统计口径

Token 监控只把明确的生成、流式生成和聊天请求纳入统计，不再把所有 Cloud Code POST 请求当成模型调用。

响应解析支持 JSON、SSE、protobuf 和 gRPC protobuf。日志标记为“官方”时，输入、输出和缓存来自响应中的 UsageMetadata；日志标记为“估算”时，输入与输出只是流量趋势，缓存显示为“未知”。官方缓存卡片和命中率只使用带 UsageMetadata 的记录，禁止用估算记录补成 `0`。

协议解析的回归测试命令：

```powershell
npm.cmd run test:token-usage
```
