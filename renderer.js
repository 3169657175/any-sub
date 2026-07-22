// ==========================================
// FRONTEND LOGIC: RENDERER (前端交互核心)
// ==========================================

// 获取常用 DOM 节点
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const logTerminal = document.getElementById('terminal-log-output');
const btnClearTerminal = document.getElementById('btn-clear-terminal');

// 路径与版本状态
const pathStatusText = document.getElementById('path-status-text');
const textOriginalVersion = document.getElementById('text-original-version');
const textPatchVersion = document.getElementById('text-patch-version');
const inputInstallDir = document.getElementById('input-install-dir');
const btnInstallPatch = document.getElementById('btn-install-patch');
const btnRestoreOriginal = document.getElementById('btn-restore-original');

// 网络配置
const switchNetworkBypass = document.getElementById('switch-network-bypass');
const btnSaveNetwork = document.getElementById('btn-save-network');

// 本地账号
const btnRefreshLocalAccounts = document.getElementById('btn-refresh-local-accounts');
const localAccountsList = document.getElementById('local-accounts-list');
const localAccountCount = document.getElementById('local-account-count');
const localAccountCurrent = document.getElementById('local-account-current');

// Skill 市场与同步
const inputSearchSkill = document.getElementById('input-search-skill');
const btnSyncGithubSkills = document.getElementById('btn-sync-github-skills');
const skillMarketSummary = document.getElementById('skill-market-summary');
let skillMarketCurrentPage = 1;
let currentMarketTab = 'market';
let installedSkillsList = [];
let mcpMarketCurrentPage = 1;
let currentMcpTab = 'market';

// MCP 安装与验证
const btnRefreshMcpStatus = document.getElementById('btn-refresh-mcp-status');
const mcpMarketSummary = document.getElementById('mcp-market-summary');
const mcpSetupModal = document.getElementById('mcp-setup-modal');
const mcpSetupSubtitle = document.getElementById('mcp-setup-subtitle');
const mcpSetupFields = document.getElementById('mcp-setup-fields');
const mcpSetupNote = document.getElementById('mcp-setup-note');
const mcpSetupResult = document.getElementById('mcp-setup-result');
const btnCloseMcpSetup = document.getElementById('btn-close-mcp-setup');
const btnCancelMcpSetup = document.getElementById('btn-cancel-mcp-setup');
const btnConfirmMcpSetup = document.getElementById('btn-confirm-mcp-setup');

// Skill 生成器 (工坊)
const inputSkillName = document.getElementById('input-skill-name');
const inputSkillDesc = document.getElementById('input-skill-desc');
const inputSkillPrompt = document.getElementById('input-skill-prompt');
const btnGenerateSkill = document.getElementById('btn-generate-skill');
const customSkillResult = document.getElementById('custom-skill-result');

// 状态池
let appPaths = null;
let mcpConfig = null;
let activeThemeId = 'native';

// ==========================================
// 1. 全局初始化与选项卡切换
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  logToTerminal('[Info] 正在初始化 AGY Hub 核心引擎...');
  
  // 绑定窗口控制按钮
  btnMinimize.addEventListener('click', () => window.agyHubAPI.minimizeWindow());
  btnClose.addEventListener('click', () => window.agyHubAPI.closeWindow());

  // 绑定选项卡点击切换
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      
      // 切换导航项 Active
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // 切换面板 Active
      tabPanes.forEach(pane => pane.classList.remove('active'));
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
      
      logToTerminal(`[Navigate] 切换至选项卡: ${item.querySelector('.nav-text').textContent}`);

      // 动态载入联动
      if (targetId === 'tab-admin-users') {
        loadAdminUserData();
      } else if (targetId === 'tab-admin-announcement') {
        loadAnnouncementHistory();
      } else if (targetId === 'tab-local-accounts') {
        loadLocalAccounts();
      }
    });
  });

  // 清除日志
  btnClearTerminal.addEventListener('click', () => {
    logTerminal.innerHTML = '[System] 日志终端已清空。';
  });

  if (btnRefreshLocalAccounts) {
    btnRefreshLocalAccounts.addEventListener('click', loadLocalAccounts);
  }

  // 【性能优化】：将原本阻塞首屏渲染的串行磁盘/IO检测重构为并发异步非阻塞加载，首屏秒开！
  doPathDetection().then(() => Promise.all([
    initNetworkStatus(),
    initMcpMarket()
  ])).then(() => {
    logToTerminal('[System] 核心管理组件并发初始化就绪，冷工业极简模式载入成功。');
  }).catch(err => {
    logToTerminal(`组件载入异常: ${err.message}`, 'error');
  });

  // 载入并初始化 Skill 推荐市场 (awesome-skills)
  initSkillMarket();
  initThemeManager();
});

async function initThemeManager() {
  const grid = document.getElementById('theme-grid');
  const statusTitle = document.getElementById('theme-status-title');
  const disableButton = document.getElementById('btn-disable-theme');
  const createButton = document.getElementById('btn-create-theme');
  const modal = document.getElementById('theme-editor-modal');
  const modalTitle = document.getElementById('theme-editor-title');
  const modalSubtitle = document.getElementById('theme-editor-subtitle');
  const modalPreview = document.getElementById('theme-editor-preview');
  const modalMessage = document.getElementById('theme-editor-message');
  const nameField = document.getElementById('theme-name-field');
  const nameInput = document.getElementById('input-theme-name');
  const paletteList = document.getElementById('theme-palette-list');
  const pickImageButton = document.getElementById('btn-pick-theme-image');
  const saveButton = document.getElementById('btn-save-theme-editor');
  const resetImageButton = document.getElementById('btn-reset-theme-image');
  const deleteButton = document.getElementById('btn-delete-custom-theme');
  if (!grid || !statusTitle || !disableButton || !createButton || !modal) return;

  let themes = [];
  let palettes = [];
  let editorState = null;

  const setBusy = (busy) => {
    grid.classList.toggle('is-busy', busy);
    disableButton.disabled = busy;
    createButton.disabled = busy;
  };

  const updateActiveState = (active) => {
    activeThemeId = active && active.enabled ? (active.sourceThemeId || active.id) : 'native';
    const selected = themes.find(theme => theme.id === activeThemeId);
    statusTitle.textContent = selected ? `当前主题：${selected.name}` : '当前主题：Antigravity 原生';
    grid.querySelectorAll('.theme-card').forEach(card => {
      const isActive = card.dataset.themeId === activeThemeId;
      card.classList.toggle('active', isActive);
      const button = card.querySelector('.theme-apply-button');
      if (button) button.textContent = isActive ? '正在使用' : '一键应用';
    });
  };

  const renderThemes = (nextThemes, active) => {
    themes = nextThemes;
    grid.innerHTML = '';
    for (const theme of themes) {
      const card = document.createElement('article');
      card.className = 'theme-card';
      card.dataset.themeId = theme.id;
      card.style.setProperty('--theme-accent', theme.accent || '#6ee7f9');

      const preview = document.createElement('div');
      preview.className = 'theme-preview';
      if (theme.previewDataUrl) preview.style.backgroundImage = `url("${theme.previewDataUrl}")`;

      const activeBadge = document.createElement('span');
      activeBadge.className = 'theme-active-badge';
      activeBadge.textContent = '已启用';
      preview.appendChild(activeBadge);

      if (theme.kind === 'custom' || theme.isCustomized) {
        const kindBadge = document.createElement('span');
        kindBadge.className = 'theme-kind-badge';
        kindBadge.textContent = theme.kind === 'custom' ? '自定义' : '已换图';
        preview.appendChild(kindBadge);
      }

      const body = document.createElement('div');
      body.className = 'theme-card-body';
      const heading = document.createElement('h3');
      heading.textContent = theme.name;
      const description = document.createElement('p');
      description.textContent = theme.description || 'Antigravity 专属主题';
      const button = document.createElement('button');
      button.className = 'theme-apply-button';
      button.type = 'button';
      button.textContent = '一键应用';
      button.addEventListener('click', async () => {
        setBusy(true);
        button.textContent = '正在应用…';
        try {
          const result = await window.agyHubAPI.setActiveTheme(theme.id);
          if (!result || !result.success) throw new Error(result?.error || '应用失败');
          updateActiveState(result.active);
          logToTerminal(`[Theme] 已切换为 ${theme.name}，Antigravity 将自动热加载。`);
        } catch (error) {
          button.textContent = '重试';
          logToTerminal(`[Theme] ${error.message}`, 'error');
        } finally {
          setBusy(false);
        }
      });
      const editButton = document.createElement('button');
      editButton.className = 'theme-edit-button';
      editButton.type = 'button';
      editButton.textContent = '编辑皮肤';
      editButton.addEventListener('click', () => openEditor(theme));
      const actions = document.createElement('div');
      actions.className = 'theme-card-actions';
      actions.append(button, editButton);
      body.append(heading, description, actions);
      card.append(preview, body);
      grid.appendChild(card);
    }
    updateActiveState(active);
  };

  const renderPaletteChoices = () => {
    paletteList.innerHTML = '';
    for (const palette of palettes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-palette-choice';
      button.style.setProperty('--palette-accent', palette.accent);
      button.dataset.paletteId = palette.id;
      button.innerHTML = '<span class="swatch"></span><span></span><span class="check">✓</span>';
      button.children[1].textContent = `${palette.name}色调`;
      button.classList.toggle('active', editorState && editorState.paletteId === palette.id);
      button.disabled = Boolean(editorState && editorState.kind === 'builtin');
      button.addEventListener('click', () => {
        if (!editorState || editorState.kind === 'builtin') return;
        editorState.paletteId = palette.id;
        paletteList.querySelectorAll('.theme-palette-choice').forEach(choice => {
          choice.classList.toggle('active', choice.dataset.paletteId === palette.id);
        });
      });
      paletteList.appendChild(button);
    }
  };

  const setEditorPreview = (dataUrl) => {
    modalPreview.classList.toggle('has-image', Boolean(dataUrl));
    modalPreview.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : '';
  };

  const closeEditor = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    editorState = null;
    modalMessage.textContent = '';
  };

  function openEditor(theme = null) {
    const isCreate = !theme;
    editorState = {
      create: isCreate,
      themeId: theme ? theme.id : '',
      kind: theme ? theme.kind : 'custom',
      paletteId: theme ? (theme.paletteId || theme.id) : (palettes[0] && palettes[0].id),
      imagePath: '',
      previewDataUrl: theme ? theme.previewDataUrl : ''
    };
    modalTitle.textContent = isCreate ? '自定义皮肤' : `编辑「${theme.name}」`;
    modalSubtitle.textContent = isCreate
      ? '上传一张壁纸，再选择与界面搭配的整体色调。'
      : theme.kind === 'builtin'
        ? '替换壁纸图片，原有的按钮、侧栏和卡片色调保持不变。'
        : '可以替换壁纸，也可以重新选择整体色调。';
    nameField.hidden = Boolean(theme && theme.kind === 'builtin');
    nameInput.value = theme && theme.kind === 'custom' ? theme.name : '';
    resetImageButton.hidden = !(theme && theme.kind === 'builtin' && theme.isCustomized);
    deleteButton.hidden = !(theme && theme.kind === 'custom');
    saveButton.textContent = isCreate ? '创建并保存' : '保存修改';
    pickImageButton.textContent = theme ? '更换图片' : '选择图片';
    modalMessage.textContent = '';
    setEditorPreview(editorState.previewDataUrl);
    renderPaletteChoices();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    if (!nameField.hidden) setTimeout(() => nameInput.focus(), 80);
  }

  const reloadThemes = async (preferredActive = null) => {
    const result = await window.agyHubAPI.listThemes();
    if (!result || !result.success) throw new Error(result?.error || '主题资源读取失败');
    palettes = result.palettes || [];
    renderThemes(result.themes || [], preferredActive || result.active || { enabled: false, id: 'native' });
  };

  createButton.addEventListener('click', () => openEditor());
  document.getElementById('btn-close-theme-editor').addEventListener('click', closeEditor);
  document.getElementById('btn-cancel-theme-editor').addEventListener('click', closeEditor);
  modal.querySelector('[data-theme-editor-close]').addEventListener('click', closeEditor);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('open')) closeEditor();
  });

  pickImageButton.addEventListener('click', async () => {
    modalMessage.textContent = '';
    const result = await window.agyHubAPI.pickThemeImage();
    if (!result || !result.success) {
      modalMessage.textContent = result?.error || '图片选择失败';
      return;
    }
    if (result.canceled) return;
    editorState.imagePath = result.filePath;
    editorState.previewDataUrl = result.previewDataUrl;
    setEditorPreview(result.previewDataUrl);
    pickImageButton.textContent = '重新选择';
  });

  saveButton.addEventListener('click', async () => {
    if (!editorState) return;
    if ((editorState.create || editorState.kind === 'builtin') && !editorState.imagePath) {
      modalMessage.textContent = editorState.create ? '请先选择一张主题图片。' : '请选择一张新的壁纸图片。';
      return;
    }
    saveButton.disabled = true;
    modalMessage.textContent = '';
    try {
      const result = await window.agyHubAPI.saveThemeDesign({
        create: editorState.create,
        themeId: editorState.themeId,
        name: nameInput.value,
        paletteId: editorState.paletteId,
        imagePath: editorState.imagePath
      });
      if (!result || !result.success) throw new Error(result?.error || '皮肤保存失败');
      renderThemes(result.themes || [], result.active || { enabled: false, id: 'native' });
      logToTerminal(`[Theme Studio] ${editorState.create ? '已创建' : '已更新'}皮肤：${result.theme.name}`);
      closeEditor();
    } catch (error) {
      modalMessage.textContent = error.message;
    } finally {
      saveButton.disabled = false;
    }
  });

  resetImageButton.addEventListener('click', async () => {
    if (!editorState || editorState.kind !== 'builtin') return;
    resetImageButton.disabled = true;
    try {
      const result = await window.agyHubAPI.resetThemeImage(editorState.themeId);
      if (!result || !result.success) throw new Error(result?.error || '恢复默认图片失败');
      renderThemes(result.themes || [], result.active || { enabled: false, id: 'native' });
      logToTerminal('[Theme Studio] 已恢复内置皮肤的默认图片。');
      closeEditor();
    } catch (error) {
      modalMessage.textContent = error.message;
    } finally {
      resetImageButton.disabled = false;
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!editorState || editorState.kind !== 'custom') return;
    if (!window.confirm('确定删除这个自定义皮肤吗？此操作不会删除你原始上传的图片。')) return;
    deleteButton.disabled = true;
    try {
      const result = await window.agyHubAPI.deleteCustomTheme(editorState.themeId);
      if (!result || !result.success) throw new Error(result?.error || '删除失败');
      renderThemes(result.themes || [], result.active || { enabled: false, id: 'native' });
      logToTerminal('[Theme Studio] 已删除自定义皮肤。');
      closeEditor();
    } catch (error) {
      modalMessage.textContent = error.message;
    } finally {
      deleteButton.disabled = false;
    }
  });

  disableButton.addEventListener('click', async () => {
    setBusy(true);
    try {
      const result = await window.agyHubAPI.disableTheme();
      if (!result || !result.success) throw new Error(result?.error || '恢复失败');
      updateActiveState(result.active);
      logToTerminal('[Theme] 已恢复 Antigravity 原生主题。');
    } catch (error) {
      logToTerminal(`[Theme] ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  try {
    await reloadThemes();
  } catch (error) {
    grid.innerHTML = `<div class="theme-loading theme-error">${error.message}</div>`;
    statusTitle.textContent = '主题管理器加载失败';
    logToTerminal(`[Theme] ${error.message}`, 'error');
  }

  // 监听来自 Antigravity 软件的主题变更事件，实现双向秒同步
  if (window.agyHubAPI.onThemeChanged) {
    window.agyHubAPI.onThemeChanged(async (activeConfig) => {
      try {
        await reloadThemes(activeConfig || { enabled: false, id: 'native' });
        logToTerminal(`[Theme] 检测到客户端同步更改主题，当前已自适应激活：${activeConfig.name || '原生主题'}`);
      } catch (err) {
        console.error('Failed to sync external theme change:', err);
      }
    });
  }
}

function createLocalAccountBadge(text, type) {
  const badge = document.createElement('span');
  badge.className = `local-account-badge ${type}`;
  badge.textContent = text;
  return badge;
}

function createLocalAccountRow(account, index, activeQuotaPromises) {
  const row = document.createElement('div');
  row.className = `local-account-row${account.current ? ' current' : ''}`;
  row.setAttribute('data-account-id', account.id);
  row.setAttribute('data-account-email', account.email || '');

  const avatar = document.createElement('div');
  avatar.className = 'local-account-avatar';
  const avatarSource = account.name || account.email || String(index + 1);
  avatar.textContent = avatarSource.trim().charAt(0).toUpperCase() || String(index + 1);

  const identity = document.createElement('div');
  identity.className = 'local-account-identity';

  const titleLine = document.createElement('div');
  titleLine.className = 'local-account-title-line';
  const name = document.createElement('span');
  name.className = 'local-account-name';
  name.textContent = account.name || '未命名账号';
  titleLine.appendChild(name);
  if (account.current) titleLine.appendChild(createLocalAccountBadge('当前使用', 'current'));

  const email = document.createElement('span');
  email.className = 'local-account-email';
  email.textContent = account.email || '未记录邮箱';
  identity.append(titleLine, email);

  const security = document.createElement('div');
  security.className = 'local-account-security';

  // 上层：状态徽章区（独立一行）
  const statusBadgeArea = document.createElement('div');
  statusBadgeArea.className = 'local-account-badge-area';
  if (account.storageState === 'encrypted') {
    statusBadgeArea.appendChild(createLocalAccountBadge('DPAPI 已加密', 'encrypted'));
  } else if (account.storageState === 'legacy') {
    statusBadgeArea.appendChild(createLocalAccountBadge('等待加密迁移', 'warning'));
  } else {
    statusBadgeArea.appendChild(createLocalAccountBadge('凭据不可用', 'muted'));
  }
  security.appendChild(statusBadgeArea);

  // 下层：操作按钮区（独立一行，保证两按钮同高同宽）
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'local-account-actions';

  // 1. 若非当前使用账号且凭证可用，添加"切换使用"按钮
  if (!account.current && account.storageState !== 'missing') {
    const btnSwitch = document.createElement('button');
    btnSwitch.className = 'btn-account-action';
    btnSwitch.textContent = '切换使用';
    btnSwitch.addEventListener('click', async (e) => {
      e.stopPropagation();
      btnSwitch.disabled = true;
      btnSwitch.textContent = '切换中...';
      try {
        const sRes = await window.agyHubAPI.switchLocalAccount(account.id);
        if (sRes && sRes.success) {
          logToTerminal(`[Account] 成功切换当前活动账户为: ${account.email}`, 'success');
          await loadLocalAccounts();
        } else {
          alert('切换失败: ' + (sRes?.error || '未知错误'));
          btnSwitch.disabled = false;
          btnSwitch.textContent = '切换使用';
        }
      } catch (err) {
        alert('切换异常: ' + err.message);
        btnSwitch.disabled = false;
        btnSwitch.textContent = '切换使用';
      }
    });
    actionsContainer.appendChild(btnSwitch);
  }

  // 2. 为所有有效账号添加"导出配置"按钮
  if (account.storageState !== 'missing') {
    const btnExport = document.createElement('button');
    btnExport.className = 'btn-account-action export';
    btnExport.textContent = '导出配置';
    btnExport.addEventListener('click', async (e) => {
      e.stopPropagation();
      btnExport.disabled = true;
      btnExport.textContent = '导出中...';
      try {
        const eRes = await window.agyHubAPI.exportLocalAccount(account.id);
        if (eRes && eRes.success) {
          logToTerminal(`[Account] 账号配置成功导出: ${account.email}`, 'success');
        } else if (eRes && eRes.code === 'CANCELED') {
          // 用户取消，静默处理
        } else {
          alert('导出失败: ' + (eRes?.error || '未知错误'));
        }
      } catch (err) {
        alert('导出发生异常: ' + err.message);
      } finally {
        btnExport.disabled = false;
        btnExport.textContent = '导出配置';
      }
    });
    actionsContainer.appendChild(btnExport);
  }

  if (actionsContainer.children.length > 0) {
    security.appendChild(actionsContainer);
  }

  row.append(avatar, identity, security);

  // 添加配额显示区
  const quotaPanel = document.createElement('div');
  quotaPanel.className = 'local-account-quota';
  
  if (account.storageState === 'missing') {
    quotaPanel.innerHTML = `<div class="quota-error">凭据不可用，请先在官方客户端登录该账号</div>`;
  } else {
    quotaPanel.innerHTML = `<div class="quota-spinner">正在查询实时额度...</div>`;
    
    // 异步拉取该账号的配额信息
    const qPromise = (async () => {
      try {
        const res = await window.agyHubAPI.fetchAccountQuota(account.id);
        if (res && res.success) {
          quotaPanel.innerHTML = `
            <div class="quota-grid">
              <div class="quota-col">
                <div class="quota-platform">Claude</div>
                <div class="quota-item">
                  <div class="quota-label"><span>5h 限制</span> <span class="quota-val">${res.quota.claude5h}</span></div>
                  <div class="quota-bar"><div class="quota-fill" style="width: ${res.quota.claude5h}"></div></div>
                </div>
                <div class="quota-item">
                  <div class="quota-label"><span>每周上限</span> <span class="quota-val">${res.quota.claudeWeekly}</span></div>
                  <div class="quota-bar"><div class="quota-fill" style="width: ${res.quota.claudeWeekly}"></div></div>
                </div>
              </div>
              <div class="quota-col">
                <div class="quota-platform">Gemini</div>
                <div class="quota-item">
                  <div class="quota-label"><span>5h 限制</span> <span class="quota-val">${res.quota.gemini5h}</span></div>
                  <div class="quota-bar"><div class="quota-fill" style="width: ${res.quota.gemini5h}"></div></div>
                </div>
                <div class="quota-item">
                  <div class="quota-label"><span>每周上限</span> <span class="quota-val">${res.quota.geminiWeekly}</span></div>
                  <div class="quota-bar"><div class="quota-fill" style="width: ${res.quota.geminiWeekly}"></div></div>
                </div>
              </div>
            </div>
          `;
          
          if (res.quotaDetails && Object.keys(res.quotaDetails).length > 0) {
            logToTerminal(`[Quota] 账号 ${account.email} 详细配额明细 (Project: ${res.projectId || '未知'}): ${JSON.stringify(res.quotaDetails)}`);
          }
          if (res.quotaDataDebug && Object.keys(res.quotaDataDebug).length > 0) {
            logToTerminal(`[Quota] 账号 ${account.email} 响应体最外层全局非 models 属性: ${JSON.stringify(res.quotaDataDebug)}`);
          }
          
          // 渲染完成后稍微延迟给进度条上色及填充，以展示顺滑过渡动画
          setTimeout(() => {
            quotaPanel.querySelectorAll('.quota-fill').forEach(fill => {
              const val = parseInt(fill.style.width) || 0;
              if (val >= 50) fill.style.backgroundColor = 'var(--text-accent, #3ba5fc)';
              else if (val >= 25) fill.style.backgroundColor = '#fca240';
              else fill.style.backgroundColor = '#f06c8b';
            });
          }, 50);

          return {
            accountId: account.id,
            success: true,
            gemini5h: parseInt(res.quota.gemini5h) || 0,
            geminiWeekly: parseInt(res.quota.geminiWeekly) || 0,
            claude5h: parseInt(res.quota.claude5h) || 0,
            claudeWeekly: parseInt(res.quota.claudeWeekly) || 0
          };
        } else {
          quotaPanel.innerHTML = `<div class="quota-error">实时额度暂未拉取成功: ${res?.error || '未知错误'}</div>`;
        }
      } catch (err) {
        quotaPanel.innerHTML = `<div class="quota-error">查询异常: ${err.message}</div>`;
      }
      return { accountId: account.id, success: false };
    })();
    
    if (activeQuotaPromises) {
      activeQuotaPromises.push(qPromise);
    }
  }
  
  row.appendChild(quotaPanel);
  return row;
}

async function loadLocalAccounts() {
  if (!localAccountsList || !localAccountCount || !localAccountCurrent) return;

  localAccountsList.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'local-accounts-state';
  loading.textContent = '正在读取本地账号...';
  localAccountsList.appendChild(loading);
  localAccountCount.textContent = '-';
  localAccountCurrent.textContent = '正在读取...';
  if (btnRefreshLocalAccounts) btnRefreshLocalAccounts.disabled = true;

  const activeQuotaPromises = [];

  try {
    const result = await window.agyHubAPI.listLocalAccounts();
    if (!result || !result.success) {
      throw new Error(result?.error || '本地账号读取失败');
    }

    const accounts = Array.isArray(result.accounts) ? result.accounts : [];
    localAccountCount.textContent = String(accounts.length);
    const current = accounts.find(account => account.current);
    localAccountCurrent.textContent = current
      ? (current.email || current.name || '已识别')
      : '未设置';
    localAccountsList.replaceChildren();

    if (accounts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'local-accounts-state empty';
      empty.textContent = '暂未发现本地账号';
      localAccountsList.appendChild(empty);
    } else {
      accounts.forEach((account, index) => {
        localAccountsList.appendChild(createLocalAccountRow(account, index, activeQuotaPromises));
      });

      // 异步执行智能算分与账号推荐标记
      if (activeQuotaPromises.length > 0) {
        (async () => {
          const quotaResults = await Promise.all(activeQuotaPromises);
          const validResults = quotaResults.filter(r => r.success);
          if (validResults.length === 0) return;

          // 核心算法函数：S = a * W + (1 - a) * H, 其中 a = 1 - (W/100)^2
          const calculateScore = (w, h) => {
            const wFraction = w / 100;
            const alpha = 1 - Math.pow(wFraction, 2);
            return alpha * w + (1 - alpha) * h;
          };

          let bestGeminiId = null;
          let bestGeminiScore = -1;
          let bestClaudeId = null;
          let bestClaudeScore = -1;

          for (const res of validResults) {
            const gScore = calculateScore(res.geminiWeekly, res.gemini5h);
            const cScore = calculateScore(res.claudeWeekly, res.claude5h);

            // 只有剩余额度大于 0% 的情况下参与算分推荐
            if (gScore > bestGeminiScore && res.geminiWeekly > 0) {
              bestGeminiScore = gScore;
              bestGeminiId = res.accountId;
            }
            if (cScore > bestClaudeScore && res.claudeWeekly > 0) {
              bestClaudeScore = cScore;
              bestClaudeId = res.accountId;
            }
          }

          if (bestGeminiId) {
            const geminiRow = localAccountsList.querySelector(`.local-account-row[data-account-id="${bestGeminiId}"]`);
            if (geminiRow) {
              const nameLine = geminiRow.querySelector('.local-account-title-line');
              if (nameLine && !nameLine.querySelector('.recommend-gemini')) {
                nameLine.appendChild(createLocalAccountBadge('💡 Gemini 推荐', 'recommend-gemini'));
                geminiRow.classList.add('recommended-card-gemini');
              }
            }
          }
          if (bestClaudeId) {
            const claudeRow = localAccountsList.querySelector(`.local-account-row[data-account-id="${bestClaudeId}"]`);
            if (claudeRow) {
              const nameLine = claudeRow.querySelector('.local-account-title-line');
              if (nameLine && !nameLine.querySelector('.recommend-claude')) {
                nameLine.appendChild(createLocalAccountBadge('💡 Claude 推荐', 'recommend-claude'));
                claudeRow.classList.add('recommended-card-claude');
              }
            }
          }
        })();
      }
    }

    logToTerminal(`[Accounts] 已读取 ${accounts.length} 个本地账号。`, 'success');
  } catch (error) {
    localAccountCount.textContent = '0';
    localAccountCurrent.textContent = '读取失败';
    localAccountsList.replaceChildren();
    const failed = document.createElement('div');
    failed.className = 'local-accounts-state error';
    failed.textContent = error.message || '本地账号读取失败';
    localAccountsList.appendChild(failed);
    logToTerminal(`[Accounts] ${error.message}`, 'error');
  } finally {
    if (btnRefreshLocalAccounts) btnRefreshLocalAccounts.disabled = false;
  }
}

// 输出日志到终端
function logToTerminal(msg, type = 'info') {
  const time = new Date().toLocaleTimeString();
  let prefix = '[LOG]';
  if (type === 'error') prefix = '❌ [ERROR]';
  if (type === 'success') prefix = '✅ [SUCCESS]';
  
  logTerminal.innerHTML += `\n[${time}] ${prefix} ${msg}`;
  logTerminal.scrollTop = logTerminal.scrollHeight; // 滚动到底部
}

// ==========================================
// 2. 自动检测目录与版本逻辑
// ==========================================
async function doPathDetection() {
  try {
    appPaths = await window.agyHubAPI.detectPaths();
    if (appPaths.detected) {
      pathStatusText.textContent = `🚀 已检测到 Antigravity 安装在：${appPaths.installDir}`;
      pathStatusText.style.color = '#00ffcc';
      inputInstallDir.value = appPaths.installDir;
      logToTerminal(`[Path] 自动检测安装目录成功，位置：${appPaths.asarPath}`, 'success');

      // 读取版本号
      const verRes = await window.agyHubAPI.getAsarVersions(appPaths.asarPath);
      if (verRes.success) {
        textOriginalVersion.textContent = `v${verRes.originalVersion}`;
        textPatchVersion.textContent = `v${verRes.patchVersion}`;
        logToTerminal(`[Version] 官方原版: v${verRes.originalVersion} | 管家补丁: v${verRes.patchVersion}`);
      }
    } else {
      pathStatusText.textContent = '⚠️ 未找到默认安装路径，请手动选择或覆盖。';
      pathStatusText.style.color = '#ff6600';
      textOriginalVersion.textContent = 'unknown';
      textPatchVersion.textContent = 'unknown';
      logToTerminal('[Path] 未在默认位置检测到客户端，请手动配置。', 'error');
    }
  } catch (err) {
    logToTerminal(`检测路径出错: ${err.message}`, 'error');
  }
}

// ==========================================
// 3. 一键汉化与还原补丁事件
// ==========================================
btnInstallPatch.addEventListener('click', async () => {
  const selectedPath = inputInstallDir.value.trim();
  if (!selectedPath) {
    alert('请选择客户端的安装路径！');
    return;
  }

  const asarPath = selectedPath.endsWith('app.asar') ? selectedPath : `${selectedPath}\\resources\\app.asar`;

  logToTerminal(`[Patch] 正在为 ${selectedPath} 注入汉化补丁...`);
  
  try {
    // 实际装配：调用 API 进行静默版本检测
    btnInstallPatch.disabled = true;
    btnInstallPatch.textContent = '正在校验并注入...';
    const res = await window.agyHubAPI.installPatch(asarPath, null, false);

    if (res.success) {
      logToTerminal(res.msg, 'success');
      alert(`汉化补丁安装成功。\n\n${res.msg}`);
      // 重新读取版本
      await doPathDetection();
    } else {
      logToTerminal(res.error, 'error');
      alert(`注入失败: ${res.error}`);
    }
  } catch (err) {
    logToTerminal(err.message, 'error');
  } finally {
    btnInstallPatch.disabled = false;
    btnInstallPatch.textContent = '注入中文汉化补丁';
  }
});

btnRestoreOriginal.addEventListener('click', async () => {
  const selectedPath = inputInstallDir.value.trim();
  if (!selectedPath) return;

  const asarPath = selectedPath.endsWith('app.asar') ? selectedPath : `${selectedPath}\\resources\\app.asar`;

  logToTerminal('[Patch] 正在尝试还原官方原版...');
  try {
    const res = await window.agyHubAPI.restoreOriginal(asarPath);
    if (res.success) {
      logToTerminal(res.msg, 'success');
      alert('🧹 还原官方英文原版成功！');
      // 重新读取版本
      await doPathDetection();
    } else {
      logToTerminal(res.error, 'error');
      alert(`还原失败: ${res.error}`);
    }
  } catch (err) {
    logToTerminal(err.message, 'error');
  }
});

// ==========================================
// 4. 极简免 TUN 分流网络状态初始化与激活
// ==========================================
async function initNetworkStatus() {
  if (!switchNetworkBypass) return;
  try {
    const res = await window.agyHubAPI.getNetworkConfig();
    if (res.success && res.data) {
      switchNetworkBypass.checked = res.data.active;
      logToTerminal(`[Network] 已成功读取上次保存的免 TUN 分流设置，当前：${res.data.active ? '已启用 (7890 端口)' : '已禁用'}`);
    }
  } catch (e) {
    switchNetworkBypass.checked = true; // 默认开启
  }
}

if (btnSaveNetwork && switchNetworkBypass) {
  btnSaveNetwork.addEventListener('click', async () => {
    const active = switchNetworkBypass.checked;
    const port = 7890; // 端口静默锁定为 7890 常用代理端口，摒弃用户手动设置

    if (active) {
      logToTerminal(`[Network] 正在检测本地代理服务 127.0.0.1:${port} 连通性...`);
      try {
        // 原生 TCP 套接字握手，不触碰命令执行
        const testResult = await window.agyHubAPI.checkProxyPort(port);
        if (!testResult.success) {
          logToTerminal(`[警告] 代理测试失败: ${testResult.error}`, 'error');
          alert(`⚠️ 本地代理端口 ${port} 连接测试未通畅！\n\n原因: ${testResult.error}\n\n建议:\n1. 确保 Clash / v2ray / NekoBox 已经在后台运行。\n2. 确认其本地 Socks / HTTP 代理端口确实为 ${7890}。`);
          switchNetworkBypass.checked = false;
          return;
        }

        logToTerminal(`[Network] 本地代理服务连接测试成功，握手耗时正常。`, 'success');
        
        const saveRes = await window.agyHubAPI.saveNetworkConfig({ mode: 'bypass', active: true, port: port });
        if (saveRes.success) {
          logToTerminal(`[Network] 免 TUN 局部加速代理已成功保存并激活！配置存入: ${saveRes.path}`, 'success');
          alert('💾 免 TUN 分流网络代理已成功保存并激活！');
        }
      } catch (err) {
        logToTerminal(err.message, 'error');
      }
    } else {
      // 用户选择关闭网络代理
      logToTerminal('[Network] 正在禁用免 TUN 局部代理，流量将走系统直连。');
      try {
        const saveRes = await window.agyHubAPI.saveNetworkConfig({ mode: 'direct', active: false, port: port });
        if (saveRes.success) {
          logToTerminal(`[Network] 网络代理已关闭！已切回全局直连模式。`, 'success');
          alert('💾 网络策略修改成功！已切回直连模式。');
        }
      } catch (err) {
        logToTerminal(err.message, 'error');
      }
    }
  });
}

// ==========================================
// 5. MCP 插件市场初始化与事件 (扩增至 8 大旗舰插件)
// ==========================================
const popularMcps = [
  {
    id: 'github-search',
    name: 'GitHub Code Search',
    desc: '让智能体能够根据指令一键在 GitHub 仓库检索相关的公开代码与架构样例。',
    package: '@modelcontextprotocol/server-github',
    note: '需要 GITHUB_PERSONAL_ACCESS_TOKEN。',
    fields: [
      { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub Personal Access Token', type: 'password', storage: 'env', required: true, placeholder: 'github_pat_...' }
    ]
  },
  {
    id: 'local-filesystem',
    name: 'Local Filesystem Sandbox',
    desc: '允许 AI 智能体在明确授权的目录内读取、写入和编辑文件。',
    package: '@modelcontextprotocol/server-filesystem',
    note: '服务只能访问你填写的目录。建议选择单独项目目录，不要授权整个系统盘。',
    fields: [
      { key: 'allowedPath', label: '允许访问的本地目录', type: 'text', storage: 'arg', required: true, placeholder: 'C:\\Users\\Public', defaultValue: 'C:\\Users\\Public' }
    ]
  },
  {
    id: 'sqlite-connector',
    name: 'SQLite Database Agent',
    desc: '支持大语言模型执行 SQL、创建表并对指定 SQLite 数据库进行实时读写。',
    package: 'mcp-sqlite',
    note: '数据库不存在时服务可能创建新文件；请确认目录具有写入权限。',
    fields: [
      { key: 'databasePath', label: 'SQLite 数据库文件', type: 'text', storage: 'arg', required: true, placeholder: 'C:\\Users\\Public\\agy-hub.db' }
    ]
  },
  {
    id: 'chrome-devtools-mcp',
    name: 'Chrome DevTools Browser',
    desc: '通过 Chrome DevTools MCP 执行网页交互、抓取、性能分析与截图调试。',
    package: 'chrome-devtools-mcp@latest',
    note: '连接您本地 Chrome 的调试端口 (http://127.0.0.1:9222)。',
    fields: []
  },
  {
    id: 'postgres-connector',
    name: 'PostgreSQL Database Agent',
    desc: '支持大语言模型连接并执行 SQL 操作指定的 PostgreSQL 数据库。',
    package: '@modelcontextprotocol/server-postgres',
    note: '连接串保存在本机 MCP 配置中。建议使用权限受限的专用数据库账号。',
    fields: [
      { key: 'databaseUrl', label: 'PostgreSQL 连接串', type: 'password', storage: 'arg', required: true, placeholder: 'postgresql://user:password@127.0.0.1:5432/database' }
    ]
  },
  {
    id: 'google-maps',
    name: 'Google Maps Location',
    desc: '让 AI 智能体调用 Google Maps API 搜索位置、商家、经纬度与路线。',
    package: '@modelcontextprotocol/server-google-maps',
    note: '需要启用对应 Google Maps API 的密钥。',
    fields: [
      { key: 'GOOGLE_MAPS_API_KEY', label: 'Google Maps API Key', type: 'password', storage: 'env', required: true, placeholder: 'AIza...' }
    ]
  },
  {
    id: 'tavily-search',
    name: 'Tavily Web Search Engine',
    desc: '为 AI 助手挂载 Tavily 搜索引擎，提供实时网页检索与内容提取。',
    package: 'tavily-mcp',
    note: '需要 Tavily API Key。',
    fields: [
      { key: 'TAVILY_API_KEY', label: 'Tavily API Key', type: 'password', storage: 'env', required: true, placeholder: 'tvly-...' }
    ]
  },
  {
    id: 'docker-engine',
    name: 'Docker Container Agent',
    desc: '允许大模型读取本地 Docker 容器、查看日志并执行容器管理操作。',
    package: 'mcp-server-docker',
    note: '需要 Docker Engine 或 Docker Desktop 已安装并运行。',
    fields: []
  },
  {
    id: 'antimetal',
    name: 'Antimetal',
    desc: '使用 AI 驱动的根因分析调查和修复软件问题。连接到你的 Antimetal 账户以搜索问题并执行分析。',
    package: 'antimetal-mcp',
    note: '连接您的 Antimetal 云服务。',
    fields: []
  },
  {
    id: 'windsor',
    name: 'Windsor.ai',
    desc: '查询处理您的营销、CRM、电子商务和仓库数据，支持 325+ 个连接器，包含 Meta 广告、Google 广告、TikTok 广告、GA4 等。',
    package: 'windsor-mcp',
    note: '需要注册 Windsor.ai 账户。',
    fields: []
  },
  {
    id: 'gitlab-orbit',
    name: 'GitLab Orbit',
    desc: '将您的 GitLab SDLC 作为知识图谱进行查询。查询群组、项目、源代码、合并请求、流水线和安全漏洞。',
    package: 'gitlab-mcp',
    note: '需要您的 GitLab 个人访问令牌（PAT）。',
    fields: []
  },
  {
    id: 'cloudrun',
    name: 'Cloud Run',
    desc: '允许大语言模型将本地应用一键部署并管理在 Google Cloud Run 容器服务上。',
    package: '@google-cloud/cloud-run-mcp',
    note: '需要您在本地配置好 Google Cloud SDK 认证登录态。',
    fields: []
  },
  {
    id: 'posthog',
    name: 'PostHog',
    desc: '提问并获取答案。该 MCP 允许大语言模型直接通过 API 访问您的 PostHog 数据以执行查询。',
    package: 'posthog-mcp',
    note: '需要配置 PostHog 项目 API 密钥。',
    fields: []
  },
  {
    id: 'gke',
    name: 'Google Kubernetes Engine (OSS)',
    desc: '允许大模型与 GKE 集群进行交互，查询集群状态、Pod 日志及资源对象。',
    package: 'gke-mcp',
    note: '需要配置 kubectl 本地认证并指向 GKE 集群。',
    fields: []
  },
  {
    id: 'dart',
    name: 'Dart',
    desc: 'Dart & Flutter MCP 服务端，向兼容的 AI 助手客户端公开 Dart (and Flutter) 开发工具操作。',
    package: 'dart-mcp',
    note: '连接 Dart SDK，需要您本地已安装 SDK 并在环境变量中。',
    fields: []
  },
  {
    id: 'firebase',
    name: 'Firebase 开发者套件',
    desc: '针对 Firebase 的模型上下文协议 (MCP) 服务端，为 AI 辅助开发工具提供协同管理您的 Firebase 项目及应用代码库的能力。',
    package: 'firebase-mcp',
    note: '需要 Firebase CLI 登录状态。',
    fields: []
  },
  {
    id: 'genkit',
    name: 'Genkit',
    desc: '针对 Genkit 的模型上下文协议 (MCP) 服务端，为 AI 辅助开发工具提供构建、测试与检查您的 Genkit 应用的能力。',
    package: 'genkit-mcp',
    note: '用于对 Genkit 流进行检查和可视化。',
    fields: []
  },
  {
    id: 'go',
    name: 'Go',
    desc: 'gopls 模型上下文协议 (MCP) 服务端，提供用于 semantic code analysis, live diagnostics, and transformation of your Go codebase 的工具。',
    package: 'go-mcp',
    note: '需要本地已安装 Go 环境并将 gopls 工具配置于 PATH 中。',
    fields: []
  },
  {
    id: 'bigquery',
    name: 'BigQuery',
    desc: '使用自然语言与您的 BigQuery 数据进行交互，该 MCP 服务允许您安全地连接到数据集以搜索数据、检查数据表并获取结构信息。',
    package: 'bigquery-mcp',
    note: '需要 Google 凭证及 BigQuery 实例读写权限。',
    fields: []
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    desc: '顺序思考组件，支持大模型在推理过程中分步骤推导和校验其思路。',
    package: '@modelcontextprotocol/server-sequential-thinking',
    note: '支持复杂的串行逻辑推理，不需要额外配置环境。',
    fields: []
  }
];

async function initMcpMarket() {
  const container = document.getElementById('mcp-list-container');
  if (!container) return;
  
  mcpConfig = { mcpServers: {} };
  if (appPaths && appPaths.mcpConfigPath) {
    const res = await window.agyHubAPI.readMcpConfig(appPaths.mcpConfigPath);
    if (res.success && res.data && typeof res.data === 'object') {
      mcpConfig = res.data;
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
      logToTerminal(`[MCP] 已读取官方配置: ${appPaths.mcpConfigPath}`, 'success');
    }
  }

  // 绑定选项卡事件
  const mcpTabMarket = document.getElementById('btn-mcp-tab-market');
  const mcpTabInstalled = document.getElementById('btn-mcp-tab-installed');

  if (mcpTabMarket && mcpTabInstalled) {
    mcpTabMarket.addEventListener('click', () => {
      currentMcpTab = 'market';
      mcpTabMarket.classList.add('active');
      mcpTabInstalled.classList.remove('active');
      mcpMarketCurrentPage = 1;
      renderMcpMarket();
    });

    mcpTabInstalled.addEventListener('click', () => {
      currentMcpTab = 'installed';
      mcpTabInstalled.classList.add('active');
      mcpTabMarket.classList.remove('active');
      mcpMarketCurrentPage = 1;
      renderMcpMarket();
    });
  }

  renderMcpMarket();
  if (btnRefreshMcpStatus) btnRefreshMcpStatus.onclick = refreshInstalledMcpStatuses;
  if (btnCloseMcpSetup) btnCloseMcpSetup.onclick = closeMcpSetup;
  if (btnCancelMcpSetup) btnCancelMcpSetup.onclick = closeMcpSetup;
  if (btnConfirmMcpSetup) btnConfirmMcpSetup.onclick = confirmMcpSetup;
  await refreshInstalledMcpStatuses();
}

const mcpRuntimeStates = new Map();
let selectedMcp = null;

function buildMcpLaunchConfig(mcp, values) {
  const args = ['/d', '/s', '/c', 'npx', '-y', mcp.package];
  const env = {};
  for (const field of mcp.fields) {
    const value = String(values[field.key] || '').trim();
    if (field.storage === 'env') env[field.key] = value;
    if (field.storage === 'arg') args.push(value);
  }
  return { command: 'cmd.exe', args, env };
}

function getExistingMcpValues(mcp) {
  const config = mcpConfig && mcpConfig.mcpServers ? mcpConfig.mcpServers[mcp.id] : null;
  const values = {};
  if (!config) return values;
  let argumentIndex = 0;
  const packageIndex = Array.isArray(config.args) ? config.args.indexOf(mcp.package) : -1;
  for (const field of mcp.fields) {
    if (field.storage === 'env') values[field.key] = config.env && config.env[field.key] || '';
    if (field.storage === 'arg') {
      values[field.key] = packageIndex >= 0 ? config.args[packageIndex + 1 + argumentIndex] || '' : '';
      argumentIndex += 1;
    }
  }
  return values;
}

function renderMcpMarket() {
  const container = document.getElementById('mcp-list-container');
  if (!container) return;
  container.replaceChildren();

  const paginationContainer = document.getElementById('mcp-market-pagination');
  const activeMcps = mcpConfig && mcpConfig.mcpServers ? mcpConfig.mcpServers : {};

  // 更新本地已部署总数角标
  const countSpan = document.getElementById('installed-mcp-count');
  if (countSpan) {
    countSpan.textContent = Object.keys(activeMcps).length;
  }

  // 1. 根据当前 Tab 整理数据源
  let sourceList = [];
  if (currentMcpTab === 'market') {
    sourceList = popularMcps;
  } else {
    sourceList = Object.keys(activeMcps).map(key => {
      const preset = popularMcps.find(p => p.id === key);
      const config = activeMcps[key];
      return {
        id: key,
        name: preset ? preset.name : key,
        desc: preset ? preset.desc : `本地独立部署的 MCP 外部工具扩展。`,
        package: preset ? preset.package : `启动命令: ${config.command} ${Array.isArray(config.args) ? config.args.join(' ') : ''}`,
        fields: preset ? preset.fields : [],
        note: preset ? preset.note : '',
        isLocalOnly: !preset
      };
    });
  }

  if (sourceList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'integration-summary';
    empty.textContent = currentMcpTab === 'market' ? '没有找到匹配的 MCP 插件。' : '当前本地未部署任何 MCP 服务。';
    container.appendChild(empty);
    if (paginationContainer) {
      paginationContainer.replaceChildren();
    }
    updateMcpSummary();
    return;
  }

  // 2. 分页处理：每页 6 个
  const pageSize = 6;
  const totalPages = Math.ceil(sourceList.length / pageSize);
  if (mcpMarketCurrentPage < 1) mcpMarketCurrentPage = 1;
  if (mcpMarketCurrentPage > totalPages) mcpMarketCurrentPage = totalPages;

  const startIndex = (mcpMarketCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, sourceList.length);
  const paginatedMcps = sourceList.slice(startIndex, endIndex);

  // 3. 循环渲染卡片
  for (const mcp of paginatedMcps) {
    const installed = Boolean(activeMcps[mcp.id]);
    const runtime = mcpRuntimeStates.get(mcp.id);
    const card = document.createElement('div');
    card.id = `mcp-card-${mcp.id}`;
    card.className = 'mcp-card';
    if (installed) card.classList.add('configured');
    if (runtime && runtime.state === 'ready') card.classList.add('active');
    if (runtime && runtime.state === 'verifying') card.classList.add('verifying');
    if (runtime && runtime.state === 'failed') card.classList.add('failed');

    const info = document.createElement('div');
    info.className = 'mcp-info';
    const title = document.createElement('h4');
    title.textContent = mcp.name;
    const desc = document.createElement('div');
    desc.className = 'mcp-desc';
    desc.textContent = mcp.desc;
    const packageName = document.createElement('div');
    packageName.className = 'mcp-package';
    packageName.textContent = mcp.package;
    info.append(title, desc, packageName);

    const control = document.createElement('div');
    control.className = 'mcp-control';
    const status = document.createElement('span');
    status.className = 'mcp-status-tag';
    
    if (runtime && runtime.state === 'ready') status.textContent = runtime.message;
    else if (runtime && runtime.state === 'verifying') status.textContent = '正在启动并执行握手...';
    else if (runtime && runtime.state === 'failed') status.textContent = runtime.message;
    else status.textContent = installed ? '已部署 · 校验通过' : (mcp.fields && mcp.fields.length ? '未配置' : '可直接启用');

    if (currentMcpTab === 'installed' || installed) {
      // 已经安装/部署的，显示红色的“卸载/删除”按钮
      const uninstallBtn = document.createElement('button');
      uninstallBtn.className = 'btn-uninstall';
      uninstallBtn.style.padding = '5px 10px';
      uninstallBtn.textContent = '卸载服务';
      uninstallBtn.addEventListener('click', async () => {
        uninstallBtn.disabled = true;
        uninstallBtn.textContent = '卸载中...';
        await uninstallMcp(mcp);
        renderMcpMarket(); // 卸载后原地刷新
      });
      control.append(status, uninstallBtn);
    } else {
      // 未配置/未启用的，显示配置开关
      const switchLabel = document.createElement('label');
      switchLabel.className = 'switch';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `switch-${mcp.id}`;
      checkbox.checked = installed;
      checkbox.disabled = runtime && runtime.state === 'verifying';
      const slider = document.createElement('span');
      slider.className = 'slider';
      switchLabel.append(checkbox, slider);
      control.append(status, switchLabel);

      checkbox.addEventListener('change', async () => {
        if (checkbox.checked) openMcpSetup(mcp);
        else {
          await uninstallMcp(mcp);
          renderMcpMarket();
        }
      });
    }

    card.append(info, control);
    container.appendChild(card);
  }

  // 4. 渲染分页导航
  if (paginationContainer) {
    paginationContainer.replaceChildren();
    if (totalPages > 1) {
      // 1. 上一页
      const prevBtn = document.createElement('button');
      prevBtn.className = `pager-btn${mcpMarketCurrentPage === 1 ? ' disabled' : ''}`;
      prevBtn.textContent = '上一页';
      prevBtn.disabled = mcpMarketCurrentPage === 1;
      prevBtn.addEventListener('click', () => {
        mcpMarketCurrentPage--;
        renderMcpMarket();
      });
      paginationContainer.appendChild(prevBtn);

      // 2. 文本显示
      const pageText = document.createElement('span');
      pageText.className = 'pager-text';
      pageText.textContent = ` 第 ${mcpMarketCurrentPage} 页 / 共 ${totalPages} 页 `;
      paginationContainer.appendChild(pageText);

      // 3. 下一页
      const nextBtn = document.createElement('button');
      nextBtn.className = `pager-btn${mcpMarketCurrentPage === totalPages ? ' disabled' : ''}`;
      nextBtn.textContent = '下一页';
      nextBtn.disabled = mcpMarketCurrentPage === totalPages;
      nextBtn.addEventListener('click', () => {
        mcpMarketCurrentPage++;
        renderMcpMarket();
      });
      paginationContainer.appendChild(nextBtn);

      // 4. 跳转
      const jumpContainer = document.createElement('div');
      jumpContainer.className = 'pager-jump-container';
      const jumpLabel1 = document.createElement('span');
      jumpLabel1.textContent = ' 跳转到 ';
      const jumpInput = document.createElement('input');
      jumpInput.type = 'number';
      jumpInput.className = 'pager-jump-input';
      jumpInput.min = 1;
      jumpInput.max = totalPages;
      jumpInput.value = mcpMarketCurrentPage;
      const jumpLabel2 = document.createElement('span');
      jumpLabel2.textContent = ' 页 ';
      const jumpBtn = document.createElement('button');
      jumpBtn.className = 'pager-btn';
      jumpBtn.textContent = '确定';
      
      const triggerJump = () => {
        let targetPage = parseInt(jumpInput.value, 10);
        if (isNaN(targetPage) || targetPage < 1) targetPage = 1;
        if (targetPage > totalPages) targetPage = totalPages;
        mcpMarketCurrentPage = targetPage;
        renderMcpMarket();
      };
      
      jumpBtn.addEventListener('click', triggerJump);
      jumpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') triggerJump();
      });

      jumpContainer.append(jumpLabel1, jumpInput, jumpLabel2, jumpBtn);
      paginationContainer.appendChild(jumpContainer);
    }
  }

  updateMcpSummary();
}

function updateMcpSummary() {
  if (!mcpMarketSummary) return;
  const activeMcps = mcpConfig && mcpConfig.mcpServers ? mcpConfig.mcpServers : {};
  const configured = Object.keys(activeMcps).length;
  const ready = Array.from(mcpRuntimeStates.values()).filter(state => state?.state === 'ready').length;
  const failed = Array.from(mcpRuntimeStates.values()).filter(state => state?.state === 'failed').length;
  mcpMarketSummary.textContent = `官方配置：${appPaths?.mcpConfigPath || '尚未检测'} · 本地已部署 ${configured} · 握手通过 ${ready} · 失败 ${failed}`;
}

function openMcpSetup(mcp) {
  selectedMcp = mcp;
  const existingValues = getExistingMcpValues(mcp);
  mcpSetupSubtitle.textContent = `${mcp.name} · ${mcp.package}`;
  mcpSetupNote.textContent = mcp.note;
  mcpSetupResult.className = 'integration-result';
  mcpSetupResult.textContent = '保存前会真实启动服务并完成 MCP initialize 握手。首次下载可能需要约一分钟。';
  mcpSetupFields.replaceChildren();

  for (const field of mcp.fields) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.htmlFor = `mcp-field-${field.key}`;
    label.textContent = field.label;
    const input = document.createElement('input');
    input.id = `mcp-field-${field.key}`;
    input.type = field.type || 'text';
    input.placeholder = field.placeholder || '';
    input.value = existingValues[field.key] || field.defaultValue || '';
    input.dataset.mcpKey = field.key;
    group.append(label, input);
    mcpSetupFields.appendChild(group);
  }

  mcpSetupModal.style.display = 'flex';
  requestAnimationFrame(() => {
    const firstInput = mcpSetupFields.querySelector('input');
    if (firstInput) firstInput.focus({ preventScroll: true });
    else btnConfirmMcpSetup.focus({ preventScroll: true });
  });
}

function closeMcpSetup() {
  mcpSetupModal.style.display = 'none';
  selectedMcp = null;
  renderMcpMarket();
}

async function confirmMcpSetup() {
  if (!selectedMcp) return;
  const values = {};
  for (const field of selectedMcp.fields) {
    const input = document.getElementById(`mcp-field-${field.key}`);
    const value = input ? input.value.trim() : '';
    if (field.required && !value) {
      mcpSetupResult.className = 'integration-result error';
      mcpSetupResult.textContent = `请填写：${field.label}`;
      if (input) input.focus();
      return;
    }
    values[field.key] = value;
  }
  const target = selectedMcp;
  btnConfirmMcpSetup.disabled = true;
  mcpSetupResult.className = 'integration-result';
  mcpSetupResult.textContent = '正在下载依赖、启动进程并验证 MCP 握手...';
  const success = await installAndVerifyMcp(target, buildMcpLaunchConfig(target, values));
  btnConfirmMcpSetup.disabled = false;
  if (success) {
    mcpSetupResult.className = 'integration-result success';
    mcpSetupResult.textContent = '安装成功，MCP 服务启动和握手验证均已通过。请在 Antigravity 的 MCP 设置中点击刷新。';
    setTimeout(closeMcpSetup, 900);
  } else {
    const runtime = mcpRuntimeStates.get(target.id);
    mcpSetupResult.className = 'integration-result error';
    mcpSetupResult.textContent = runtime?.message || 'MCP 验证失败';
  }
}

async function installAndVerifyMcp(mcp, launchConfig, persist = true) {
  mcpRuntimeStates.set(mcp.id, { state: 'verifying', message: '正在验证...' });
  renderMcpMarket();
  logToTerminal(`[MCP] 正在真实启动并验证 ${mcp.name}...`);
  const result = await window.agyHubAPI.validateMcpServer(launchConfig);
  if (!result.success) {
    const message = `${result.error}${result.details ? `：${result.details}` : ''}`.slice(0, 220);
    mcpRuntimeStates.set(mcp.id, { state: 'failed', message });
    renderMcpMarket();
    logToTerminal(`[MCP] ${mcp.name} 验证失败：${message}`, 'error');
    return false;
  }

  if (persist) {
    if (!mcpConfig) mcpConfig = { mcpServers: {} };
    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    mcpConfig.mcpServers[mcp.id] = launchConfig;
    const saveResult = await window.agyHubAPI.writeMcpConfig(appPaths.mcpConfigPath, mcpConfig);
    if (!saveResult.success) {
      mcpRuntimeStates.set(mcp.id, { state: 'failed', message: `握手通过，但配置保存失败：${saveResult.error}` });
      renderMcpMarket();
      return false;
    }
  }

  const version = result.serverVersion ? ` ${result.serverVersion}` : '';
  mcpRuntimeStates.set(mcp.id, { state: 'ready', message: `已安装 · 验证通过${version}` });
  renderMcpMarket();
  logToTerminal(`[MCP] ${mcp.name} 安装成功，服务 ${result.serverName}${version} 握手通过。`, 'success');
  return true;
}

async function uninstallMcp(mcp) {
  if (!mcpConfig || !mcpConfig.mcpServers) return;
  delete mcpConfig.mcpServers[mcp.id];
  const result = await window.agyHubAPI.writeMcpConfig(appPaths.mcpConfigPath, mcpConfig);
  if (!result.success) {
    mcpRuntimeStates.set(mcp.id, { state: 'failed', message: `卸载失败：${result.error}` });
  } else {
    mcpRuntimeStates.delete(mcp.id);
    logToTerminal(`[MCP] 已移除 ${mcp.name} 配置。请在 Antigravity MCP 设置中刷新。`, 'success');
  }
  renderMcpMarket();
}

async function refreshInstalledMcpStatuses() {
  if (btnRefreshMcpStatus) btnRefreshMcpStatus.disabled = true;
  const installed = popularMcps.filter(mcp => mcpConfig && mcpConfig.mcpServers && mcpConfig.mcpServers[mcp.id]);
  for (const mcp of installed) {
    await installAndVerifyMcp(mcp, mcpConfig.mcpServers[mcp.id], false);
  }
  if (btnRefreshMcpStatus) btnRefreshMcpStatus.disabled = false;
  updateMcpSummary();
}

// ==========================================
// 6. 智能体 Skill 推荐市场与 GitHub 在线同步
// ==========================================
let currentSkills = []; // 存储当前加载的 Skill 库列表

const localPresetSkills = [
  {
    id: 'git-expert',
    name: '⚡ conventional-git-log',
    badge: '工作流提效',
    desc: '自动读取当前工作区的 Git 变更差分 (diff)，按照 Conventional Commit 规范智能生成极简、中文化提交日志。',
    prompt: '你是一个 Git 提交规范大师。当检测到工作区存在文件改动时，主动调用 git diff 提取详细差分。基于改动，按照 conventional commits 标准（形如 feat: 增加某功能、fix: 修复某漏洞）生成一句话极其精炼的中文提交日志。严禁废话。'
  },
  {
    id: 'antigravity-guide',
    name: '🧠 antigravity-guide',
    badge: '官方全能指南',
    desc: '帮助用户全景解答 Antigravity CLI 命令行工具 (agy)、快捷键配置、侧边栏及 MCP 全景开发技巧。',
    prompt: '你是一个 Antigravity 2.0 的资深全景导航专家。如果用户对 CLI 命令、 sidecars 运行参数或 XML 插件体系结构有任何疑问，你要给出最硬核、最直截了当的命令演示，引导用户配置 rules 和 skills。'
  },
  {
    id: 'science-researcher',
    name: '🧬 literature-researcher',
    badge: '学术科研助理',
    desc: '自动调用 PubMed 与 EuropePMC 学术接口，高效进行跨文献检索、蛋白质 AlphaFold 置信度分析与临床试验匹配。',
    prompt: '你是一个尖端生物和医学科研智能助理。当用户输入 UniProt Accession ID、疾病或药物名称时，你应当熟练调用 science 插件库中的 pdb-database、pubmed-database 和 alphafold 接口，从权威文献中提取三维结构置信度、靶点通路及临床试验进展，以专业学术报告格式输出。'
  },
  {
    id: 'frontend-crafter',
    name: '🎨 premium-ui-crafter',
    badge: '高级 UI 润色',
    desc: '让智能体精通磨砂毛玻璃特效、霓虹呼吸渐变发光等前沿 Cyber 赛博美学，给所有前端修改注入灵魂。',
    prompt: '你是一个视觉审美极其苛刻的前端设计工程师。每当修改或重构用户的 HTML/CSS 时，禁止使用平庸、廉价的白色渐变排版。必须融入暗黑背景、透明度毛玻璃（backdrop-filter）、高斯模糊悬浮投影、流光溢彩的渐变呼吸灯边框，使其散发高端赛博科技质感。'
  },
  {
    id: 'python-debugger',
    name: '🐍 python-debugger',
    badge: '调试优化',
    desc: '对 Python 代码进行静态深度诊断，捕捉隐藏死循环、内存溢出与空对象引用漏洞，自动给出修复补丁。',
    prompt: '你是一个 Python 资深调试专家。每当分析用户代码时，审查其变量生命周期、异常处理块以及内存释放，发现漏洞立即给出符合 PEP8 规范的修复代码。'
  },
  {
    id: 'readme-generator',
    name: '📝 awesome-readme-builder',
    badge: '文档生成',
    desc: '生成符合顶级开源项目标准的 Markdown 项目 README 结构，集成发光 Badge 标签、表格和 SVG 脑图。',
    prompt: '你是一个顶级开源项目文档专家。基于用户提供的项目结构 and 简述，生成极致美观、带有 Shields.io 发光标签、安装、测试和详细贡献指南的 README.md 模板。'
  },
  {
    id: 'sql-optimizer',
    name: '📊 sql-slow-query-tuner',
    badge: '数据查询调优',
    desc: '针对 MySQL/PostgreSQL 慢查询进行执行计划（EXPLAIN）分析，给出复合索引建议和重构写法。',
    prompt: '你是一个资深数据库 DBA。用户输入慢 SQL 语句时，分析其可能造成全表扫描的环节，提供添加覆盖索引、联合索引或使用 JOIN 子查询优化的替代写法。'
  },
  {
    id: 'security-audit',
    name: '🛡️ owasp-security-auditor',
    badge: '代码审计',
    desc: '审查 Java / Node.js 源码，智能检索 OWASP Top 10 级别漏洞（如 SQL 注入、SSRF 伪造与密码硬编码）。',
    prompt: '你是一个白帽子代码审计专家。静态审查用户提交的代码片段，检查是否存在敏感变量硬编码、不安全的 exec 调用与未过滤的用户输入输入，给出带防御代码的分析报告。'
  },
  {
    id: 'regex-wizard',
    name: '🧙 regex-magic-wand',
    badge: '正则表达式',
    desc: '将用户的自然语言描述一键转换为包含前瞻、后顾过滤的高效率正则表达式，并提供可视化边界解释。',
    prompt: '你是一个正则表达式巫师。接收到匹配要求后，给出最精简且无回溯风险的正则公式，并用可视化文字解释每一段匹配符号所起到的作用。'
  },
  {
    id: 'unit-test-generator',
    name: '🧪 jest-pytest-crafter',
    badge: '单元测试',
    desc: '基于现有函数/类结构，自动生成 Jest (JS) 或 Pytest (Python) 单元测试覆盖，内置 Mock 数据与边缘条件。',
    prompt: '你是一个测试开发专家。读取用户的函数后，自动生成 100% 覆盖率的单元测试代码，确保包括边界值、异常值以及正常逻辑测试，并使用 mock 技术隔离外部请求。'
  },
  {
    id: 'translation-pro',
    name: '🌐 academic-translator',
    badge: '润色翻译',
    desc: '信达雅多国学术级双语对照翻译，消除中式英文翻译僵硬感，自动转换语法为地道英文句式。',
    prompt: '你是一个国际学术期刊的主编。将用户的中文段落翻译为地道、严谨、多用学术名词的主动/被动语态英文，并输出双语对照。'
  },
  {
    id: 'api-craft',
    name: '🔌 restful-graphql-designer',
    badge: 'API 设计',
    desc: '基于业务概念，自动设计规范的 RESTful API 路由或 GraphQL Schema 定义，含状态码与参数要求。',
    prompt: '你是一个系统架构设计师。根据用户提供的业务模型，规划符合最佳设计标准的 RESTful 路由规范（包含 HTTP 动词、统一状态码）或 GraphQL 类型声明。'
  }
];

const installedSkillIds = new Set();
let installedSkillsPath = '';

function yamlString(value) {
  return JSON.stringify(String(value || '').replace(/\r?\n/g, ' '));
}

async function refreshInstalledSkills() {
  const result = await window.agyHubAPI.listInstalledSkills();
  installedSkillIds.clear();
  if (result.success) {
    installedSkillsPath = result.path;
    for (const skill of result.skills) {
      if (skill.valid) installedSkillIds.add(skill.id);
    }
  }
  return result;
}

async function refreshInstalledSkillsAndRender() {
  const res = await window.agyHubAPI.listInstalledSkills();
  if (res.success) {
    installedSkillsList = res.skills.map(s => ({
      id: s.id,
      name: s.id,
      desc: s.description || '已安装的本地技能',
      badge: '本地已校验',
      sourceType: 'local'
    }));
    
    // 更新已安装数量数字
    const countSpan = document.getElementById('installed-skills-count');
    if (countSpan) {
      countSpan.textContent = installedSkillsList.length;
    }
    
    if (currentMarketTab === 'installed') {
      renderSkillMarket(installedSkillsList);
    }
  }
}

async function initSkillMarket() {
  await refreshInstalledSkills();
  await refreshInstalledSkillsAndRender(); // 初始化已安装数量
  
  const cacheRes = await window.agyHubAPI.readSkillCatalogCache();
  if (cacheRes.success && cacheRes.skills.length > 0) {
    currentSkills = cacheRes.skills;
    if (currentMarketTab === 'market') {
      renderSkillMarket(currentSkills);
    }
    // 静默在后台自动拉取更新
    silentSyncGithubSkills();
  } else {
    currentSkills = localPresetSkills.map(skill => ({ ...skill, sourceType: 'builtin' }));
    if (currentMarketTab === 'market') {
      renderSkillMarket(currentSkills);
    }
    // 首次无缓存，自动执行一次带 UI 提示的同步
    syncGithubSkillCatalog();
  }

  // 绑定搜索输入框联动的过滤筛选
  inputSearchSkill.addEventListener('input', () => {
    skillMarketCurrentPage = 1;
    const keyword = inputSearchSkill.value.toLowerCase().trim();
    const sourceList = (currentMarketTab === 'installed') ? installedSkillsList : currentSkills;
    const filtered = sourceList.filter(skill => {
      return [skill.id, skill.name, skill.desc, skill.badge]
        .some(value => String(value || '').toLowerCase().includes(keyword));
    });
    renderSkillMarket(filtered);
  });

  btnSyncGithubSkills.addEventListener('click', syncGithubSkillCatalog);

  // 选项卡切换事件绑定
  const tabMarket = document.getElementById('btn-tab-market');
  const tabInstalled = document.getElementById('btn-tab-installed');

  if (tabMarket && tabInstalled) {
    tabMarket.addEventListener('click', () => {
      currentMarketTab = 'market';
      tabMarket.classList.add('active');
      tabInstalled.classList.remove('active');
      skillMarketCurrentPage = 1;
      inputSearchSkill.value = '';
      renderSkillMarket(currentSkills);
    });

    tabInstalled.addEventListener('click', async () => {
      currentMarketTab = 'installed';
      tabInstalled.classList.add('active');
      tabMarket.classList.remove('active');
      skillMarketCurrentPage = 1;
      inputSearchSkill.value = '';
      await refreshInstalledSkillsAndRender();
    });
  }
}

async function silentSyncGithubSkills() {
  const result = await window.agyHubAPI.fetchSkillCatalog();
  if (result.success) {
    const localIds = new Set(localPresetSkills.map(skill => skill.id));
    const remoteSkills = result.skills
      .filter(skill => !localIds.has(skill.id))
      .map(skill => ({
        id: skill.id,
        name: skill.name,
        desc: skill.description,
        badge: `${skill.category} · ${skill.risk}`,
        path: skill.path,
        setup: skill.setup,
        sourceType: 'remote'
      }));
    currentSkills = [
      ...localPresetSkills.map(skill => ({ ...skill, sourceType: 'builtin' })),
      ...remoteSkills
    ];
    if (currentMarketTab === 'market' && !inputSearchSkill.value.trim()) {
      renderSkillMarket(currentSkills);
    }
  }
}

async function syncGithubSkillCatalog() {
  btnSyncGithubSkills.disabled = true;
  btnSyncGithubSkills.textContent = '正在同步...';
  skillMarketSummary.className = 'integration-summary';
  skillMarketSummary.textContent = '正在读取真实 skills_index.json 清单...';
  logToTerminal('[Skill] 正在同步 sickn33/agentic-awesome-skills 真实技能清单...');
  const result = await window.agyHubAPI.fetchSkillCatalog();
  if (!result.success) {
    skillMarketSummary.className = 'integration-result error';
    skillMarketSummary.textContent = `同步失败：${result.error}。仍可使用内置技能。`;
    logToTerminal(`[Skill] GitHub 技能清单同步失败：${result.error}`, 'error');
  } else {
    const localIds = new Set(localPresetSkills.map(skill => skill.id));
    const remoteSkills = result.skills
      .filter(skill => !localIds.has(skill.id))
      .map(skill => ({
        id: skill.id,
        name: skill.name,
        desc: skill.description,
        badge: `${skill.category} · ${skill.risk}`,
        path: skill.path,
        setup: skill.setup,
        sourceType: 'remote'
      }));
    currentSkills = [
      ...localPresetSkills.map(skill => ({ ...skill, sourceType: 'builtin' })),
      ...remoteSkills
    ];
    inputSearchSkill.value = '';
    skillMarketCurrentPage = 1;
    renderSkillMarket(currentSkills);
    skillMarketSummary.className = 'integration-result success';
    skillMarketSummary.textContent = `同步成功：${result.source} 提供 ${result.total} 个可安装技能；高风险/攻击性条目已自动过滤。`;
    logToTerminal(`[Skill] 已同步 ${result.total} 个真实社区技能。`, 'success');
    setTimeout(() => {
      if (skillMarketSummary.className.includes('success')) {
        skillMarketSummary.className = 'integration-summary';
        skillMarketSummary.textContent = `本地已校验 ${installedSkillIds.size} 个 Skill · 当前匹配 ${currentSkills.length} 个 · 目录：${installedSkillsPath}`;
      }
    }, 5000);
  }
  btnSyncGithubSkills.disabled = false;
  btnSyncGithubSkills.textContent = '同步 GitHub 社区仓库';
}

function renderSkillMarket(skills) {
  const container = document.getElementById('skills-market-container');
  if (!container) return;
  container.replaceChildren();

  const paginationContainer = document.getElementById('skills-market-pagination');

  if (skills.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'integration-summary';
    empty.textContent = '没有找到匹配的技能。';
    container.appendChild(empty);
    if (paginationContainer) {
      paginationContainer.replaceChildren();
    }
    return;
  }

  // 分页参数：每页 6 个
  const pageSize = 6;
  const totalPages = Math.ceil(skills.length / pageSize);

  // 保证当前页合法
  if (skillMarketCurrentPage < 1) skillMarketCurrentPage = 1;
  if (skillMarketCurrentPage > totalPages) skillMarketCurrentPage = totalPages;

  // 截取当前页的技能
  const startIndex = (skillMarketCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, skills.length);
  const paginatedSkills = skills.slice(startIndex, endIndex);

  // 渲染当前页的卡片
  for (const skill of paginatedSkills) {
    const installed = installedSkillIds.has(skill.id);
    const card = document.createElement('div');
    card.className = `skill-market-card${installed ? ' installed' : ''}`;

    const header = document.createElement('div');
    header.className = 'skill-market-header';
    const name = document.createElement('span');
    name.className = 'skill-market-name';
    name.textContent = skill.name;
    name.title = skill.name;
    const badge = document.createElement('span');
    badge.className = 'skill-market-badge';
    badge.textContent = installed ? '已安装 · 校验通过' : skill.badge;
    header.append(name, badge);

    const desc = document.createElement('div');
    desc.className = 'skill-market-desc';
    desc.textContent = skill.desc || skill.description || '已安装的本地技能';

    // 渲染动作按钮区
    const footer = document.createElement('div');
    footer.className = 'skill-market-footer';

    if (installed) {
      // 已经安装的技能，渲染红色的删除按钮，并可以点击卸载
      const uninstallButton = document.createElement('button');
      uninstallButton.className = 'btn-uninstall';
      uninstallButton.textContent = '删除技能';
      footer.appendChild(uninstallButton);

      uninstallButton.addEventListener('click', async () => {
        uninstallButton.disabled = true;
        uninstallButton.textContent = '正在删除...';
        logToTerminal(`[Skill] 正在删除技能 ${skill.id}...`);
        const result = await window.agyHubAPI.uninstallSkill(skill.id);
        if (result.success) {
          installedSkillIds.delete(skill.id);
          logToTerminal(`[Skill] 技能已物理删除：${skill.id}`, 'success');
          
          // 重新拉取本地列表以更新角标及渲染
          await refreshInstalledSkillsAndRender();
          
          if (currentMarketTab === 'market') {
            // 在推荐市场大列表时，重绘即可
            renderSkillMarket(skills);
          }
        } else {
          uninstallButton.disabled = false;
          uninstallButton.textContent = '删除技能';
          logToTerminal(`[Skill] 删除技能失败：${result.error}`, 'error');
        }
      });
    } else {
      // 未安装的技能，渲染“安装并验证”按钮
      const installButton = document.createElement('button');
      installButton.className = 'btn-import';
      installButton.textContent = '安装并验证';
      footer.appendChild(installButton);

      installButton.addEventListener('click', async () => {
        installButton.disabled = true;
        installButton.textContent = '正在安装...';
        logToTerminal(`[Skill] 正在安装并验证 ${skill.id}...`);
        let result;
        if (skill.sourceType === 'remote') {
          result = await window.agyHubAPI.installCommunitySkill({ id: skill.id, path: skill.path });
        } else {
          const skillMarkdown = `---\nname: ${skill.id}\ndescription: ${yamlString(skill.desc)}\n---\n\n# ${skill.id}\n\n${skill.prompt}\n`;
          result = await window.agyHubAPI.writeSkill(null, skill.id, skillMarkdown);
        }

        if (result.success && result.verified) {
          installedSkillIds.add(skill.id);
          logToTerminal(`[Skill] ${skill.id} 已成功导入并校验通过。`, 'success');
          skillMarketSummary.className = 'integration-result success';
          skillMarketSummary.textContent = `安装成功：${skill.id} · 已写入官方全局目录 · SKILL.md 校验通过。重新打开对话后可被 Antigravity 发现。`;
          
          // 重新拉取以同步已安装角标
          await refreshInstalledSkillsAndRender();
          
          if (currentMarketTab === 'market') {
            renderSkillMarket(skills); // 原地重绘
          }

          setTimeout(() => {
            if (skillMarketSummary.className.includes('success')) {
              skillMarketSummary.className = 'integration-summary';
              skillMarketSummary.textContent = `本地已校验 ${installedSkillIds.size} 个 Skill · 当前匹配 ${skills.length} 个 · 第 ${skillMarketCurrentPage}/${totalPages} 页 · 目录：${installedSkillsPath}`;
            }
          }, 5000);
        } else {
          installButton.disabled = false;
          installButton.textContent = '重试安装';
          skillMarketSummary.className = 'integration-result error';
          skillMarketSummary.textContent = `安装失败：${result.error || '未知错误'}`;
          logToTerminal(`[Skill] ${skill.id} 安装失败：${result.error || '未知错误'}`, 'error');
        }
      });
    }

    card.append(header, desc, footer);
    container.appendChild(card);
  }

  // 渲染分页导航
  if (paginationContainer) {
    paginationContainer.replaceChildren();
    
    if (totalPages > 1) {
      // 1. 上一页按钮
      const prevBtn = document.createElement('button');
      prevBtn.className = `pager-btn${skillMarketCurrentPage === 1 ? ' disabled' : ''}`;
      prevBtn.textContent = '上一页';
      prevBtn.disabled = skillMarketCurrentPage === 1;
      prevBtn.addEventListener('click', () => {
        skillMarketCurrentPage--;
        renderSkillMarket(skills);
      });
      paginationContainer.appendChild(prevBtn);

      // 2. 文本显示：第 X 页 / 共 Y 页
      const pageText = document.createElement('span');
      pageText.className = 'pager-text';
      pageText.textContent = ` 第 ${skillMarketCurrentPage} 页 / 共 ${totalPages} 页 `;
      paginationContainer.appendChild(pageText);

      // 3. 下一页按钮
      const nextBtn = document.createElement('button');
      nextBtn.className = `pager-btn${skillMarketCurrentPage === totalPages ? ' disabled' : ''}`;
      nextBtn.textContent = '下一页';
      nextBtn.disabled = skillMarketCurrentPage === totalPages;
      nextBtn.addEventListener('click', () => {
        skillMarketCurrentPage++;
        renderSkillMarket(skills);
      });
      paginationContainer.appendChild(nextBtn);

      // 4. 页码跳转区
      const jumpContainer = document.createElement('div');
      jumpContainer.className = 'pager-jump-container';
      
      const jumpLabel1 = document.createElement('span');
      jumpLabel1.textContent = ' 跳转到 ';
      
      const jumpInput = document.createElement('input');
      jumpInput.type = 'number';
      jumpInput.className = 'pager-jump-input';
      jumpInput.min = 1;
      jumpInput.max = totalPages;
      jumpInput.value = skillMarketCurrentPage;
      
      const jumpLabel2 = document.createElement('span');
      jumpLabel2.textContent = ' 页 ';
      
      const jumpBtn = document.createElement('button');
      jumpBtn.className = 'pager-btn';
      jumpBtn.textContent = '确定';
      
      const triggerJump = () => {
        let targetPage = parseInt(jumpInput.value, 10);
        if (isNaN(targetPage) || targetPage < 1) targetPage = 1;
        if (targetPage > totalPages) targetPage = totalPages;
        skillMarketCurrentPage = targetPage;
        renderSkillMarket(skills);
      };

      jumpBtn.addEventListener('click', triggerJump);
      jumpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') triggerJump();
      });

      jumpContainer.append(jumpLabel1, jumpInput, jumpLabel2, jumpBtn);
      paginationContainer.appendChild(jumpContainer);
    }
  }

  // 统计信息
  if (!skillMarketSummary.classList.contains('success') && !skillMarketSummary.classList.contains('error')) {
    skillMarketSummary.textContent = `本地已校验 ${installedSkillIds.size} 个 Skill · 当前匹配 ${skills.length} 个 · 第 ${skillMarketCurrentPage}/${totalPages} 页 · 目录：${installedSkillsPath}`;
  }
}

// ==========================================
// 7. 自定义 Skill 创造工坊
// ==========================================
btnGenerateSkill.addEventListener('click', async () => {
  const name = inputSkillName.value.trim().toLowerCase();
  const desc = inputSkillDesc.value.trim();
  const prompt = inputSkillPrompt.value.trim();

  if (!name || !desc || !prompt) {
    customSkillResult.className = 'integration-result error';
    customSkillResult.textContent = '请完整填写技能标识、功能说明和指令内容。';
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) {
    customSkillResult.className = 'integration-result error';
    customSkillResult.textContent = '技能标识只能使用小写英文字母、数字和连字符，长度为 2-64 个字符。';
    return;
  }

  logToTerminal(`[Skill] 正在编译新自定义智能体技能 [${name}]...`);

  const skillMarkdown = `---
name: ${name}
description: ${yamlString(desc)}
---

# ${name}

${prompt}
`;

  try {
    btnGenerateSkill.disabled = true;
    customSkillResult.className = 'integration-result';
    customSkillResult.textContent = '正在写入官方目录并重新读取校验...';
    const res = await window.agyHubAPI.writeSkill(null, name, skillMarkdown);
    if (res.success && res.verified) {
      installedSkillIds.add(name);
      customSkillResult.className = 'integration-result success';
      customSkillResult.textContent = `创建成功并校验通过：${res.path}。重新打开 Antigravity 对话后可被发现。`;
      logToTerminal(`自定义 Skill [${name}] 已写入官方目录并校验通过。`, 'success');
      inputSkillName.value = '';
      inputSkillDesc.value = '';
      inputSkillPrompt.value = '';
    } else {
      customSkillResult.className = 'integration-result error';
      customSkillResult.textContent = `创建失败：${res.error}`;
      logToTerminal(`Skill 生成失败: ${res.error}`, 'error');
    }
  } catch (err) {
    customSkillResult.className = 'integration-result error';
    customSkillResult.textContent = `创建失败：${err.message}`;
    logToTerminal(err.message, 'error');
  } finally {
    btnGenerateSkill.disabled = false;
  }
});

// ==========================================
// 8. 终端控制台手动折叠交互逻辑 (完全静默，默认且一直保持折叠)
// ==========================================
const btnToggleTerminal = document.getElementById('btn-toggle-terminal');
const terminalBar = document.getElementById('terminal-bar');

if (btnToggleTerminal && terminalBar) {
  // 确保初始加载时绝对收起
  terminalBar.classList.remove('expanded');
  btnToggleTerminal.textContent = '显示终端';

  btnToggleTerminal.addEventListener('click', () => {
    const isExpanded = terminalBar.classList.toggle('expanded');
    btnToggleTerminal.textContent = isExpanded ? '隐藏终端' : '显示终端';
    
    // 同步给父容器 main-wrapper 切换高度避让 class
    const mainWrapper = document.querySelector('.main-wrapper');
    if (mainWrapper) {
      mainWrapper.classList.toggle('terminal-expanded', isExpanded);
    }
  });

  // 重写输出日志到终端的 logToTerminal (完全静默更新，不干扰主界面)
  const originalLogToTerminal = window.logToTerminal;
  window.logToTerminal = function(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    let prefix = '[LOG]';
    if (type === 'error') prefix = '❌ [ERROR]';
    if (type === 'success') prefix = '✅ [SUCCESS]';
    
    logTerminal.innerHTML += `\n[${time}] ${prefix} ${msg}`;
    logTerminal.scrollTop = logTerminal.scrollHeight;
  };
}

// ==========================================
// 9. 网页与桌面结合：极客登录与反馈看板前端交互驱动 (高级重构版)
// ==========================================
let currentUser = null;
let uploadedImageUrl = ''; // 全局保存发帖已上传图片的 R2 CDN 链接
let uploadedAnnImageUrl = ''; // 全局保存发布公告已上传图片的 R2 CDN 链接
let uploadTarget = 'feedback'; // 'feedback' 或 'announcement'

function initFeedbackBoard() {
  const tabFeedback = document.getElementById('tab-feedback');
  if (!tabFeedback) return;

  // --- A. 全局模态框控制 ---
  const authModal = document.getElementById('auth-modal');
  const btnTitlebarLogin = document.getElementById('btn-titlebar-login');
  const btnCloseAuthModal = document.getElementById('btn-close-auth-modal');
  const btnLockTriggerLogin = document.getElementById('btn-lock-trigger-login');

  const focusActiveAuthInput = () => {
    if (!authModal || authModal.style.display === 'none') return;
    const activeForm = authModal.querySelector('.auth-form-box.active');
    const targetInput = activeForm?.querySelector('input:not([disabled])');
    if (targetInput) {
      targetInput.focus({ preventScroll: true });
    }
  };

  const showAuthModal = async () => {
    if (!authModal) return;
    authModal.style.display = 'flex';
    authModal.style.pointerEvents = 'auto';
    authModal.setAttribute('aria-hidden', 'false');
    void authModal.offsetHeight;
    try {
      await window.agyHubAPI.focusMainWindow();
    } catch (_) {}
    requestAnimationFrame(() => requestAnimationFrame(focusActiveAuthInput));
  };

  const hideAuthModal = () => {
    if (!authModal) return;
    if (authModal.contains(document.activeElement)) document.activeElement.blur();
    authModal.style.display = 'none';
    authModal.setAttribute('aria-hidden', 'true');
  };

  if (btnTitlebarLogin) btnTitlebarLogin.addEventListener('click', showAuthModal);
  if (btnLockTriggerLogin) btnLockTriggerLogin.addEventListener('click', showAuthModal);
  if (btnCloseAuthModal) btnCloseAuthModal.addEventListener('click', hideAuthModal);

  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) hideAuthModal();
    });
    window.addEventListener('focus', () => {
      requestAnimationFrame(focusActiveAuthInput);
    });
  }

  // --- A.2 详情模态框关闭控制 ---
  const detailModal = document.getElementById('feedback-detail-modal');
  const detailModalCloseBtn = document.getElementById('detail-modal-close-btn');
  if (detailModalCloseBtn && detailModal) {
    detailModalCloseBtn.addEventListener('click', () => {
      detailModal.classList.remove('active');
      setTimeout(() => { detailModal.style.display = 'none'; }, 280);
      // 不触发全量 loadFeedbacks，保留当前卡片的点赞状态
    });
    detailModal.addEventListener('click', (e) => {
      if (e.target === detailModal) {
        detailModal.classList.remove('active');
        setTimeout(() => { detailModal.style.display = 'none'; }, 280);
        // 不触发全量 loadFeedbacks，保留当前卡片的点赞状态
      }
    });
  }


  // --- 内联 Auth 提示与焦点修复函数 ---
  const showAuthBanner = (msg, type = 'error') => {
    const banner = document.getElementById('auth-msg-banner');
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = 'block';
    if (type === 'success') {
      banner.style.background = 'rgba(16, 185, 129, 0.15)';
      banner.style.border = '1px solid rgba(16, 185, 129, 0.4)';
      banner.style.color = '#34d399';
    } else {
      banner.style.background = 'rgba(244, 63, 94, 0.15)';
      banner.style.border = '1px solid rgba(244, 63, 94, 0.4)';
      banner.style.color = '#fb7185';
    }
  };

  const clearAuthBanner = () => {
    const banner = document.getElementById('auth-msg-banner');
    if (banner) banner.style.display = 'none';
  };

  // --- B. 登录与注册 Tab 切换 ---
  const btnTabLogin = document.getElementById('btn-tab-login');
  const btnTabRegister = document.getElementById('btn-tab-register');
  const formLoginBox = document.getElementById('form-login-box');
  const formRegisterBox = document.getElementById('form-register-box');
  const inputLoginUser = document.getElementById('input-login-username');
  const inputLoginPass = document.getElementById('input-login-password');
  const inputRegUser = document.getElementById('input-reg-username');
  const inputRegPass = document.getElementById('input-reg-password');

  if (btnTabLogin && btnTabRegister) {
    btnTabLogin.addEventListener('click', async () => {
      btnTabLogin.classList.add('active');
      btnTabRegister.classList.remove('active');
      formLoginBox.classList.add('active');
      formRegisterBox.classList.remove('active');
      clearAuthBanner();
      try {
        await window.agyHubAPI.focusMainWindow();
      } catch (_) {}
      setTimeout(() => {
        if (inputLoginUser && inputLoginUser.value.trim()) {
          inputLoginPass && inputLoginPass.focus({ preventScroll: true });
        } else if (inputLoginUser) {
          inputLoginUser.focus({ preventScroll: true });
        }
      }, 50);
    });

    btnTabRegister.addEventListener('click', async () => {
      btnTabRegister.classList.add('active');
      btnTabLogin.classList.remove('active');
      formRegisterBox.classList.add('active');
      formLoginBox.classList.remove('active');
      clearAuthBanner();
      try {
        await window.agyHubAPI.focusMainWindow();
      } catch (_) {}
      setTimeout(() => {
        if (inputRegUser) inputRegUser.focus({ preventScroll: true });
      }, 50);
    });
  }

  // --- C. 提交登录 ---
  const btnSubmitLogin = document.getElementById('btn-submit-login');

  if (btnSubmitLogin) {
    btnSubmitLogin.addEventListener('click', async () => {
      const username = inputLoginUser.value.trim();
      const password = inputLoginPass.value.trim();

      if (!username || !password) {
        showAuthBanner('⚠️ 请填写完整账号与密码！', 'error');
        if (!username) inputLoginUser.focus();
        else inputLoginPass.focus();
        return;
      }

      btnSubmitLogin.disabled = true;
      btnSubmitLogin.textContent = '正在安全登录...';
      clearAuthBanner();

      try {
        const res = await window.agyHubAPI.authLogin(username, password);
        if (res.success) {
          logToTerminal(`[Auth] 极客账号 @${username} 登录成功！`, 'success');
          inputLoginUser.value = '';
          inputLoginPass.value = '';
          currentUser = res.data;
          logToTerminal(`[Auth-Login] 内存会话已载入, Token: ${currentUser.token ? (currentUser.token.slice(0, 10) + '...') : '无'}`, 'success');
          updateAuthUI();
          hideAuthModal();
          loadFeedbacks(); // 刷新以同步渲染“删除”按钮
          loadAdminUserData(); // 如果是管理员，获取用户列表信息
        } else {
          showAuthBanner(`❌ 登录失败: ${res.error || '密码错误或账号不存在'}`, 'error');
          logToTerminal(`[Auth] 登录失败: ${res.error}`, 'error');
          try {
            await window.agyHubAPI.focusMainWindow();
          } catch (_) {}
          setTimeout(() => {
            if (inputLoginPass) {
              inputLoginPass.focus({ preventScroll: true });
              inputLoginPass.select();
            }
          }, 50);
        }
      } catch (err) {
        showAuthBanner(`⚠️ 登录异常: ${err.message}`, 'error');
        logToTerminal(`[Auth] 登录异常: ${err.message}`, 'error');
      } finally {
        btnSubmitLogin.disabled = false;
        btnSubmitLogin.textContent = '立即登录';
      }
    });
  }

  // --- D. 提交注册 ---
  const btnSubmitRegister = document.getElementById('btn-submit-register');

  if (btnSubmitRegister) {
    btnSubmitRegister.addEventListener('click', async () => {
      const username = inputRegUser.value.trim();
      const password = inputRegPass.value.trim();

      if (!username || !password) {
        showAuthBanner('⚠️ 请填写完整的账号与设置密码！', 'error');
        if (!username) inputRegUser.focus();
        else inputRegPass.focus();
        return;
      }
      if (username.length < 3 || username.length > 20) {
        showAuthBanner('⚠️ 用户名长度必须在 3 到 20 字之间！', 'error');
        inputRegUser.focus();
        return;
      }
      if (password.length < 6) {
        showAuthBanner('⚠️ 密码长度不能少于 6 位！', 'error');
        inputRegPass.focus();
        return;
      }

      btnSubmitRegister.disabled = true;
      btnSubmitRegister.textContent = '正在提交注册...';
      clearAuthBanner();

      try {
        const res = await window.agyHubAPI.authRegister(username, password);
        if (res.success) {
          logToTerminal(`[Auth] 新账号 @${username} 注册成功。`, 'success');
          inputRegUser.value = '';
          inputRegPass.value = '';
          
          // 自动平滑切换到登录面板
          btnTabLogin.click();
          inputLoginUser.value = username;
          inputLoginPass.value = '';
          
          showAuthBanner(`🎉 账号 @${username} 注册成功！请输入密码完成登录。`, 'success');
          
          try {
            await window.agyHubAPI.focusMainWindow();
          } catch (_) {}
          
          setTimeout(() => {
            if (inputLoginPass) {
              inputLoginPass.focus({ preventScroll: true });
            }
          }, 80);
        } else {
          showAuthBanner(`❌ 注册失败: ${res.error || '用户名已被占用'}`, 'error');
          logToTerminal(`[Auth] 注册失败: ${res.error}`, 'error');
          try {
            await window.agyHubAPI.focusMainWindow();
          } catch (_) {}
          setTimeout(() => {
            if (inputRegUser) inputRegUser.focus({ preventScroll: true });
          }, 50);
        }
      } catch (err) {
        showAuthBanner(`⚠️ 注册异常: ${err.message}`, 'error');
        logToTerminal(`[Auth] 注册异常: ${err.message}`, 'error');
      } finally {
        btnSubmitRegister.disabled = false;
        btnSubmitRegister.textContent = '提交注册';
      }
    });
  }

  // --- E. 账号注销 (右上角) ---
  const btnTitlebarLogout = document.getElementById('btn-titlebar-logout');
  if (btnTitlebarLogout) {
    btnTitlebarLogout.addEventListener('click', async () => {
      await window.agyHubAPI.authLogout();
      logToTerminal('[Auth] 极客账号已退出登录。');
      currentUser = null;
      updateAuthUI();
      loadFeedbacks();
      try {
        await window.agyHubAPI.focusMainWindow();
      } catch (_) {}
      requestAnimationFrame(() => {
        const loginButton = document.getElementById('btn-titlebar-login');
        if (loginButton) loginButton.focus({ preventScroll: true });
      });
    });
  }

  // --- F. 侧边栏官网外部跳转 ---
  const btnVisitWebsite = document.getElementById('btn-visit-website');
  if (btnVisitWebsite) {
    btnVisitWebsite.addEventListener('click', () => {
      window.agyHubAPI.openExternalUrl('https://myagy.me/');
      logToTerminal('[Website] 已调用默认浏览器跳转至网站 myagy.me');
    });
  }

  // --- G. 字数计数器监听 ---
  const inputFeedbackContent = document.getElementById('input-feedback-content');
  const textCharCounter = document.getElementById('text-char-counter');
  if (inputFeedbackContent && textCharCounter) {
    inputFeedbackContent.addEventListener('input', () => {
      const len = inputFeedbackContent.value.length;
      textCharCounter.textContent = `${len} / 500`;
    });
  }
  const feedbackClickTargets = [
    inputFeedbackContent,
    document.getElementById('btn-trigger-upload'),
    document.getElementById('btn-send-feedback')
  ].filter(Boolean);
  feedbackClickTargets.forEach(target => {
    target.addEventListener('pointerdown', async () => {
      try {
        await window.agyHubAPI.focusMainWindow();
      } catch (_) {}
      if (target === inputFeedbackContent) {
        requestAnimationFrame(() => inputFeedbackContent.focus({ preventScroll: true }));
      }
    }, { capture: true });
  });

  // --- H. 本地截图文件直接上传 (支持多场景分流) ---
  const btnTriggerUpload = document.getElementById('btn-trigger-upload');
  const btnTriggerAnnUpload = document.getElementById('btn-trigger-ann-upload');
  const inputFileImage = document.getElementById('input-file-image');
  
  // 反馈预览
  const uploadPreviewWrapper = document.getElementById('upload-preview-wrapper');
  const imgUploadPreview = document.getElementById('img-upload-preview');
  const textUploadStatus = document.getElementById('text-upload-status');
  const btnRemoveUploadedImg = document.getElementById('btn-remove-uploaded-img');

  // 公告预览
  const annUploadPreviewWrapper = document.getElementById('ann-upload-preview-wrapper');
  const imgAnnUploadPreview = document.getElementById('img-ann-upload-preview');
  const textAnnUploadStatus = document.getElementById('text-ann-upload-status');
  const btnRemoveAnnUploadedImg = document.getElementById('btn-remove-ann-uploaded-img');

  if (inputFileImage) {
    if (btnTriggerUpload) {
      btnTriggerUpload.addEventListener('click', () => {
        uploadTarget = 'feedback';
        inputFileImage.click();
      });
    }
    if (btnTriggerAnnUpload) {
      btnTriggerAnnUpload.addEventListener('click', () => {
        uploadTarget = 'announcement';
        inputFileImage.click();
      });
    }

    inputFileImage.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!currentUser || !currentUser.token) {
        alert('请先登录后再上传图片');
        e.target.value = '';
        return;
      }

      if (!file.type.startsWith('image/')) {
        alert('只允许上传图片文件！');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert('图片大小不能超过 5MB！');
        return;
      }

      // 所见即所得本地缓存临时展示
      const objectUrl = URL.createObjectURL(file);
      if (uploadTarget === 'feedback') {
        if (uploadPreviewWrapper && imgUploadPreview) {
          imgUploadPreview.src = objectUrl;
          uploadPreviewWrapper.style.display = 'flex';
          textUploadStatus.textContent = '⏳ 正在上传...';
          textUploadStatus.style.color = 'var(--text-muted)';
        }
      } else {
        if (annUploadPreviewWrapper && imgAnnUploadPreview) {
          imgAnnUploadPreview.src = objectUrl;
          annUploadPreviewWrapper.style.display = 'flex';
          textAnnUploadStatus.textContent = '⏳ 正在上传...';
          textAnnUploadStatus.style.color = 'var(--text-muted)';
        }
      }

      try {
        const uploadResult = await window.agyHubAPI.uploadImage(file.path, uploadTarget);

        if (uploadResult.success && uploadResult.url) {
          if (uploadTarget === 'feedback') {
            uploadedImageUrl = uploadResult.url;
            textUploadStatus.textContent = '✅ 上传成功';
            textUploadStatus.style.color = 'var(--accent-green)';
            logToTerminal('[Upload] 反馈图片上传 R2 成功！', 'success');
          } else {
            uploadedAnnImageUrl = uploadResult.url;
            textAnnUploadStatus.textContent = '✅ 上传成功';
            textAnnUploadStatus.style.color = 'var(--accent-green)';
            logToTerminal('[Upload] 公告图片上传 R2 成功！', 'success');
          }
        } else {
          throw new Error(uploadResult.error || '服务器拒绝了上传');
        }
      } catch (err) {
        if (uploadTarget === 'feedback') {
          textUploadStatus.textContent = '❌ 上传失败';
          textUploadStatus.style.color = '#ff3333';
        } else {
          textAnnUploadStatus.textContent = '❌ 上传失败';
          textAnnUploadStatus.style.color = '#ff3333';
        }
        logToTerminal(`[Upload] 图片上传失败: ${err.message}`, 'error');
        alert(`图片上传失败: ${err.message}`);
      }
    });
  }

  // 移除已选图片
  if (btnRemoveUploadedImg) {
    btnRemoveUploadedImg.addEventListener('click', () => {
      if (inputFileImage) inputFileImage.value = '';
      uploadedImageUrl = '';
      if (uploadPreviewWrapper) uploadPreviewWrapper.style.display = 'none';
      if (imgUploadPreview) imgUploadPreview.src = '';
      logToTerminal('[Upload] 已清除待发送反馈截图。');
    });
  }

  // 移除公告图片
  if (btnRemoveAnnUploadedImg) {
    btnRemoveAnnUploadedImg.addEventListener('click', () => {
      if (inputFileImage) inputFileImage.value = '';
      uploadedAnnImageUrl = '';
      if (annUploadPreviewWrapper) annUploadPreviewWrapper.style.display = 'none';
      if (imgAnnUploadPreview) imgAnnUploadPreview.src = '';
      logToTerminal('[Upload] 已清除待发布公告截图。');
    });
  }

  // --- I. 发送反馈留言 ---
  const btnSendFeedback = document.getElementById('btn-send-feedback');
  if (btnSendFeedback) {
    btnSendFeedback.addEventListener('click', async () => {
      if (!currentUser) {
        alert('🔒 请先登录您的极客账号后再发表反馈！');
        return;
      }

      const content = inputFeedbackContent.value.trim();

      if (!content) {
        alert('反馈内容不能为空！');
        return;
      }

      btnSendFeedback.disabled = true;
      btnSendFeedback.textContent = '发送中...';

      const res = await window.agyHubAPI.submitFeedback(content, uploadedImageUrl);
      btnSendFeedback.disabled = false;
      btnSendFeedback.textContent = '发送';

      if (res.success) {
        logToTerminal('[Feedback] 优化反馈发送成功！数据已云同步。', 'success');
        inputFeedbackContent.value = '';
        if (textCharCounter) textCharCounter.textContent = '0 / 500';
        if (btnRemoveUploadedImg) btnRemoveUploadedImg.click(); // 清理上传预览
        loadFeedbacks(); // 刷新看板列表
      } else {
        const handled = await handleSessionExpiry(res.error);
        if (!handled) alert(res.error || '发送失败');
        logToTerminal(`[Feedback] 提交失败: ${res.error}`, 'error');
      }
    });
  }

  // --- J. 用户管理与公告独立 Tab 事件绑定 ---
  const adminUsersListContainer = document.getElementById('admin-users-list-container');
  const adminUsersListPanel = document.getElementById('admin-users-list-panel');
  const adminUserDetailPanel = document.getElementById('admin-user-detail-panel');
  const btnBackToUsers = document.getElementById('btn-back-to-users');
  const btnSubmitDetailResetPass = document.getElementById('btn-submit-detail-reset-pass');
  const inputDetailNewPass = document.getElementById('input-detail-new-pass');

  const btnPublishAnnouncement = document.getElementById('btn-publish-announcement');
  const inputAnnounceContent = document.getElementById('input-announce-content');
  const inputAnnounceEditId = document.getElementById('input-announce-edit-id');
  const btnCancelAnnEdit = document.getElementById('btn-cancel-ann-edit');
  const textAnnFormTitle = document.getElementById('text-ann-form-title');

  // J.1 用户详情返回
  if (btnBackToUsers) {
    btnBackToUsers.addEventListener('click', () => {
      if (adminUsersListPanel && adminUserDetailPanel) {
        adminUserDetailPanel.style.display = 'none';
        adminUsersListPanel.style.display = 'block';
        loadAdminUserData();
      }
    });
  }

  // J.2 提交详情下用户密码重置
  if (btnSubmitDetailResetPass && inputDetailNewPass) {
    btnSubmitDetailResetPass.addEventListener('click', async () => {
      if (!currentUser || currentUser.role !== 'admin') return;

      const usernameText = document.getElementById('text-detail-username').textContent;
      const targetUsername = usernameText.replace('@', '').trim();
      const targetNewPassword = inputDetailNewPass.value.trim();

      if (!targetUsername || !targetNewPassword) {
        alert('请输入重设的新密码！');
        return;
      }
      if (targetNewPassword.length < 6) {
        alert('新密码长度不能少于 6 位！');
        return;
      }

      btnSubmitDetailResetPass.disabled = true;
      btnSubmitDetailResetPass.textContent = '正在重设...';

      try {
        const resetRes = await fetch('https://nhw1029.pages.dev/api/auth/reset-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + currentUser.token
          },
          body: JSON.stringify({ username: targetUsername, new_password: targetNewPassword })
        });
        const resetResult = await resetRes.json();

        if (resetRes.ok && resetResult.success) {
          logToTerminal(`[Admin] 用户 @${targetUsername} 密码重设成功！`, 'success');
          alert(`🎉 重设成功！用户 @${targetUsername} 的密码已被强制重置为：${targetNewPassword}`);
          inputDetailNewPass.value = '';
        } else {
          alert(`重设失败: ${resetResult.error}`);
        }
      } catch (err) {
        alert(`重置错误: ${err.message}`);
      } finally {
        btnSubmitDetailResetPass.disabled = false;
        btnSubmitDetailResetPass.textContent = '提交重置';
      }
    });
  }

  // J.3 公告图片上传直接共用前面全局定义的 H. 多端上传分流机制（无需在此重复绑定以防止变量重复声明）

  // J.4 公告发布/更新提交
  if (btnPublishAnnouncement && inputAnnounceContent) {
    btnPublishAnnouncement.addEventListener('click', async () => {
      if (!currentUser || currentUser.role !== 'admin') return;

      const content = inputAnnounceContent.value.trim();
      if (!content) {
        alert('请输入公告内容！');
        return;
      }

      const editId = inputAnnounceEditId.value;

      btnPublishAnnouncement.disabled = true;
      btnPublishAnnouncement.textContent = editId ? '正在保存修改...' : '正在发布公告...';

      try {
        const bodyData = { content, image_url: uploadedAnnImageUrl };
        if (editId) bodyData.id = parseInt(editId);

        const annRes = await fetch('https://nhw1029.pages.dev/api/announcement', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + currentUser.token
          },
          body: JSON.stringify(bodyData)
        });
        const annResult = await annRes.json();

        if (annRes.ok && annResult.success) {
          logToTerminal(editId ? `[Admin] 成功更新公告 ID: ${editId}` : '[Admin] 云端新公告发布成功！', 'success');
          alert(editId ? '🎉 公告修改成功！' : '🎉 公告发布成功！');
          
          inputAnnounceContent.value = '';
          inputAnnounceEditId.value = '';
          if (btnRemoveAnnUploadedImg) btnRemoveAnnUploadedImg.click();
          if (btnCancelAnnEdit) btnCancelAnnEdit.click();
          
          loadAnnouncementHistory();
          loadAnnouncementSystemDesktop();
        } else {
          alert(`操作失败: ${annResult.error}`);
        }
      } catch (err) {
        alert(`系统错误: ${err.message}`);
      } finally {
        btnPublishAnnouncement.disabled = false;
        btnPublishAnnouncement.textContent = inputAnnounceEditId.value ? '保存公告修改' : '发布公告';
      }
    });
  }

  // J.5 取消编辑公告
  if (btnCancelAnnEdit) {
    btnCancelAnnEdit.addEventListener('click', () => {
      inputAnnounceEditId.value = '';
      inputAnnounceContent.value = '';
      if (btnRemoveAnnUploadedImg) btnRemoveAnnUploadedImg.click();
      if (textAnnFormTitle) textAnnFormTitle.textContent = '📢 发布系统新公告';
      btnPublishAnnouncement.textContent = '发布公告';
      btnCancelAnnEdit.style.display = 'none';
    });
  }

  // --- K. 大图灯箱预览控制 ---
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxLargeImg = document.getElementById('lightbox-large-img');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');

  const hideLightbox = () => {
    if (lightboxModal) lightboxModal.style.display = 'none';
  };

  if (btnCloseLightbox) btnCloseLightbox.addEventListener('click', hideLightbox);
  if (lightboxModal) {
    lightboxModal.addEventListener('click', (e) => {
      hideLightbox();
    });
  }

  // 初始化检查本地登录会话并拉取留言板
  checkAuthSession();
  loadFeedbacks();
  
  // 桌面端专属：自动获取置顶公告并在最上方展示
  loadAnnouncementSystemDesktop();
}

async function checkAuthSession() {
  const res = await window.agyHubAPI.getAuthSession();
  if (res.success && res.data) {
    currentUser = res.data;
    logToTerminal(`[Auth-Loader] 自动载入本地登录: @${currentUser.username}, Token: ${currentUser.token ? (currentUser.token.slice(0, 10) + '...') : '无'}`, 'success');
    updateAuthUI();
    loadFeedbacks();
    loadAdminUserData();
  } else {
    logToTerminal(`[Auth-Loader] 本地未检测到已保存的登录会话`, 'info');
  }
}

// 获取管理员工作台所需的用户列表与数据统计 (渲染为平铺网格，并绑定二级详情交互)
async function loadAdminUserData() {
  if (!currentUser || currentUser.role !== 'admin') return;

  const usersContainer = document.getElementById('admin-users-list-container');
  const countSpan = document.getElementById('text-admin-users-count');

  if (!usersContainer) return;

  usersContainer.innerHTML = '<div class="no-data-tip">⏳ 正在读取系统用户数据...</div>';

  try {
    const usersRes = await fetch('https://nhw1029.pages.dev/api/auth/users', {
      headers: { 'Authorization': 'Bearer ' + currentUser.token }
    });
    const users = await usersRes.json();

    if (usersRes.ok && Array.isArray(users)) {
      if (countSpan) countSpan.textContent = users.length;

      if (users.length === 0) {
        usersContainer.innerHTML = '<div class="no-data-tip">🏜️ 系统内暂无注册用户。</div>';
        return;
      }

      let usersHtml = '';
      users.forEach(u => {
        usersHtml += `
          <div class="card user-item-card" data-username="${u.username}" style="border: 1px solid rgba(255,255,255,0.06); padding: 16px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; background: rgba(255,255,255,0.01);">
            <div style="font-size: 13px; font-weight: bold; color: var(--neon-cyan); margin-bottom: 8px;">@${u.username}</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-bottom: 4px;">发表反馈: <span style="color: #fff; font-weight: bold;">${u.feedback_count || 0}</span> 条</div>
            <div style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); margin-bottom: 10px;">角色: ${u.role === 'admin' ? '🛡️ 管理员' : '👤 普通极客'}</div>
            <div style="font-size: 9px; text-align: right; color: var(--neon-cyan);">点击管理账号 &rarr;</div>
          </div>
        `;
      });
      usersContainer.innerHTML = usersHtml;

      const userCards = usersContainer.querySelectorAll('.user-item-card');
      userCards.forEach(card => {
        card.addEventListener('click', () => {
          const targetUser = card.getAttribute('data-username');
          showAdminUserDetail(targetUser);
        });
      });
    } else {
      usersContainer.innerHTML = `<div class="no-data-tip">❌ 载入失败: ${users.error}</div>`;
      if (usersRes.status === 401 || (users.error && (users.error.includes('会话') || users.error.includes('登录')))) {
        handleSessionExpiry(users.error);
      }
    }
  } catch (err) {
    usersContainer.innerHTML = `<div class="no-data-tip">❌ 系统错误: ${err.message}</div>`;
  }
}

// 检测后端接口错误信息中是否包含 Token 失效/会话过期，只进行友好警示，绝不强制登出或清空缓存，保留已登录状态
async function handleSessionExpiry(errorMsg) {
  logToTerminal(`[DEBUG] 进入会话失效校验，错误消息为: "${errorMsg}"`, 'info');
  const isExpired = errorMsg && (
    errorMsg.includes('请先登录') || 
    errorMsg.includes('会话已') || 
    errorMsg.includes('Token') ||
    errorMsg.includes('未登录') ||
    errorMsg.includes('已过期')
  );
  if (isExpired) {
    logToTerminal(`[Auth] 后端提示登录态异常: ${errorMsg}`, 'error');
    alert(`🔒 操作未成功，后端提示：\n${errorMsg}\n\n如果您未登录，请点击右上角重新登录您的账号。`);
    return true;
  }
  return false;
}

// 更新全局登录 UI 状态 (联动管理员工作台显示/隐藏)
function updateAuthUI() {
  const btnTitlebarLogin = document.getElementById('btn-titlebar-login');
  const dropdownUser = document.getElementById('titlebar-user-dropdown');
  const textTitlebarUsername = document.getElementById('text-titlebar-username');
  
  const writeLockOverlay = document.getElementById('write-lock-overlay');
  const inputFeedbackContent = document.getElementById('input-feedback-content');
  const btnTriggerUpload = document.getElementById('btn-trigger-upload');
  const btnSendFeedback = document.getElementById('btn-send-feedback');

  const adminNavs = document.querySelectorAll('.nav-admin-only');

  if (currentUser) {
    if (btnTitlebarLogin) btnTitlebarLogin.style.display = 'none';
    if (dropdownUser) dropdownUser.style.display = 'flex';
    if (textTitlebarUsername) textTitlebarUsername.textContent = `@${currentUser.username}`;

    if (writeLockOverlay) {
      writeLockOverlay.style.display = 'none';
      writeLockOverlay.style.pointerEvents = 'none';
      writeLockOverlay.setAttribute('aria-hidden', 'true');
    }
    if (inputFeedbackContent) inputFeedbackContent.removeAttribute('disabled');
    if (btnTriggerUpload) btnTriggerUpload.removeAttribute('disabled');
    if (btnSendFeedback) btnSendFeedback.removeAttribute('disabled');

    // 独立 Tab 可见性控制
    if (currentUser.role === 'admin') {
      adminNavs.forEach(nav => nav.style.display = 'flex');
    } else {
      adminNavs.forEach(nav => nav.style.display = 'none');
      redirectFromAdminTab();
    }
  } else {
    if (btnTitlebarLogin) btnTitlebarLogin.style.display = 'block';
    if (dropdownUser) dropdownUser.style.display = 'none';

    if (writeLockOverlay) {
      writeLockOverlay.style.display = 'flex';
      writeLockOverlay.style.pointerEvents = 'auto';
      writeLockOverlay.setAttribute('aria-hidden', 'false');
    }
    if (inputFeedbackContent) inputFeedbackContent.setAttribute('disabled', 'true');
    if (btnTriggerUpload) btnTriggerUpload.setAttribute('disabled', 'true');
    if (btnSendFeedback) btnSendFeedback.setAttribute('disabled', 'true');

    adminNavs.forEach(nav => nav.style.display = 'none');
    redirectFromAdminTab();
  }
}

// 强制重定向辅助函数：防非管理员非法留存
function redirectFromAdminTab() {
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav) {
    const target = activeNav.getAttribute('data-target');
    if (target === 'tab-admin-users' || target === 'tab-admin-announcement') {
      const homeNav = document.querySelector('.nav-item[data-target="tab-patch"]');
      if (homeNav) homeNav.click();
    }
  }
}

// 异步加载渲染反馈列表 (支持大图灯箱唤醒)
async function loadFeedbacks() {
  const container = document.getElementById('feedback-flow-list');
  if (!container) return;

  container.innerHTML = `
    <div class="skeleton-loader">
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </div>
  `;

  const res = await window.agyHubAPI.fetchFeedbacks();
  if (!res.success) {
    container.innerHTML = `<div class="no-data-tip">❌ 数据载入失败: ${res.error}，请检查网络。</div>`;
    return;
  }

  const list = res.data;
  if (!list || list.length === 0) {
    container.innerHTML = `<div class="no-data-tip">🏜️ 云端暂无留言。欢迎发表您的极客反馈！</div>`;
    return;
  }

  // 写入全局缓存
  window.currentFeedbacksDesktop = list;

  // A. 按照点赞数优先，时间降序进行高级排序
  list.sort((a, b) => {
    const likesA = a.likes_count || 0;
    const likesB = b.likes_count || 0;
    if (likesB !== likesA) {
      return likesB - likesA;
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  let html = '';
  list.forEach(fb => {
    const isOwnerOrAdmin = currentUser && (currentUser.role === 'admin' || currentUser.username === fb.username);
    const deleteButton = isOwnerOrAdmin 
      ? `<button class="btn-delete-fb" data-id="${fb.id}" title="删除该反馈">🗑️ 删除</button>`
      : '';
      
    const isAdminAuthor = fb.username === 'niu1029';
    const authorClass = isAdminAuthor ? 'feedback-author admin-author' : 'feedback-author';
    const dateText = new Date(fb.created_at).toLocaleString();

    let imageTag = '';
    if (fb.image_url && fb.image_url.trim()) {
      imageTag = `<img src="${fb.image_url.trim()}" class="feedback-image-preview img-trigger-lightbox" alt="用户反馈截图" loading="lazy">`;
    }

    // B. 内容大于 120 字截断
    const isLong = fb.content.length > 120;
    const displayContent = isLong ? escapeHTML(fb.content.slice(0, 120)) + '...' : escapeHTML(fb.content);
    const showMoreBtn = isLong 
      ? `<button class="show-detail-btn" style="background: rgba(0, 245, 255, 0.05); border: 1px dashed rgba(0, 245, 255, 0.2); color: var(--neon-cyan); padding: 4px 12px; border-radius: 6px; font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; margin-top: 6px;">📖 展开全文</button>` 
      : '';

    const heartSvg = `
      <svg class="heart-svg" viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle;">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
      </svg>
    `;

    const repliesCount = fb.replies ? fb.replies.length : 0;

    // C. 点赞和回复操作栏 (小红书心形点赞 + 评论数)
    const postActionBar = `
      <div class="post-action-bar" style="display: flex; gap: 16px; align-items: center; margin-top: 12px; justify-content: flex-end; border-top: 1px solid rgba(255,255,255,0.02); padding-top: 8px;">
        <button type="button" class="action-text-btn" style="color: var(--text-muted); font-size: 11.5px; display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; cursor: pointer;">
          💬 <span id="main-comment-count-${fb.id}">${repliesCount}</span> 条评论
        </button>
        <button type="button" class="heart-like-btn ${fb.has_liked ? 'liked' : ''}" data-id="${fb.id}" id="like-btn-${fb.id}">
          ${heartSvg}
          <span id="like-count-${fb.id}">${fb.likes_count || 0}</span>
        </button>
      </div>
    `;

    html += `
      <div class="feedback-item" data-id="${fb.id}" style="cursor: pointer; margin-bottom: 12px;">
        <div class="feedback-meta">
          <span class="${authorClass}">${fb.username}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="feedback-date">${dateText}</span>
            ${deleteButton}
          </div>
        </div>
        <div class="feedback-body">${displayContent}</div>
        ${showMoreBtn}
        ${imageTag}
        ${postActionBar}
      </div>
    `;
  });

  container.innerHTML = html;

  // 1. 物理级级联删除绑定
  const deleteButtons = container.querySelectorAll('.btn-delete-fb');
  deleteButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // 阻止冒泡到卡片详情
      const fbId = btn.getAttribute('data-id');
      if (confirm('⚠️ 警告：物理级级联删除操作不可逆，将连同该留言下所有二级回复一并清理！是否确认删除？')) {
        btn.disabled = true;
        btn.textContent = '删除中...';
        const delRes = await window.agyHubAPI.deleteFeedback(fbId);
        if (delRes.success) {
          logToTerminal(`[Feedback] 成功物理级联删除留言 ID: ${fbId}`, 'success');
          loadFeedbacks();
        } else {
          alert(`删除失败: ${delRes.error}`);
          btn.disabled = false;
          btn.textContent = '🗑️ 删除';
        }
      }
    });
  });

  // 2. 点击图片拉起全屏灯箱模态预览 (Lightbox)
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxLargeImg = document.getElementById('lightbox-large-img');
  const previewImages = container.querySelectorAll('.img-trigger-lightbox');

  previewImages.forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止冒泡到卡片详情
      if (lightboxModal && lightboxLargeImg) {
        lightboxLargeImg.src = img.src;
        lightboxModal.style.display = 'flex';
      }
    });
  });

  // 3. 卡片点击事件监听 -> 展开详情弹窗
  const postCards = container.querySelectorAll('.feedback-item');
  postCards.forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      openFeedbackDetailDesktop(parseInt(id));
    });
  });

  // 4. 点赞按钮事件监听 (局部瞬间重绘)
  const likeBtns = container.querySelectorAll('.heart-like-btn');
  likeBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // 阻止冒泡到卡片详情
      if (!currentUser) {
        alert('🔒 请先登录您的账号后再进行点赞！');
        return;
      }
      const id = btn.getAttribute('data-id');
      btn.disabled = true;
      try {
        const response = await fetch('https://nhw1029.pages.dev/api/feedback/like', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + currentUser.token
          },
          body: JSON.stringify({ feedback_id: parseInt(id) })
        });
        const data = await response.json();
        if (response.ok && data.success) {
          logToTerminal(`[Feedback] 点赞/取消点赞 ID: ${id}`, 'success');
          
          const btnMain = document.getElementById(`like-btn-${id}`);
          const countMain = document.getElementById(`like-count-${id}`);
          const btnDetail = document.getElementById(`detail-like-btn-${id}`);
          const countDetail = document.getElementById(`detail-like-count-${id}`);

          if (btnMain && countMain) {
            countMain.textContent = data.likes_count;
            if (data.liked) btnMain.classList.add('liked');
            else btnMain.classList.remove('liked');
          }
          if (btnDetail && countDetail) {
            countDetail.textContent = data.likes_count;
            if (data.liked) btnDetail.classList.add('liked');
            else btnDetail.classList.remove('liked');
          }

          // 同步缓存
          const res = await window.agyHubAPI.fetchFeedbacks();
          if (res.success) {
            window.currentFeedbacksDesktop = res.data;
          }
        } else {
          logToTerminal(`[DEBUG] 主贴点赞失败原始错误: "${data.error}"`, 'error');
          const handled = await handleSessionExpiry(data.error);
          if (!handled) alert(`点赞失败: ${data.error}`);
        }
      } catch (err) {
        alert(`网络错误: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// 桌面端详情弹窗拉开
async function openFeedbackDetailDesktop(id) {
  const modal = document.getElementById('feedback-detail-modal');
  const modalBody = document.getElementById('detail-modal-body');
  if (!modal || !modalBody) return;

  const fb = window.currentFeedbacksDesktop ? window.currentFeedbacksDesktop.find(f => f.id === id) : null;
  if (!fb) return;

  renderDetailModalContentDesktop(fb);
  modal.style.display = 'flex';
}
window.openFeedbackDetailDesktop = openFeedbackDetailDesktop;

// 渲染桌面详情弹窗内部
function renderDetailModalContentDesktop(fb) {
  const modalBody = document.getElementById('detail-modal-body');
  if (!modalBody) return;

  const dateStr = new Date(fb.created_at).toLocaleString();
  const imgTag = fb.image_url 
    ? `<img src="${fb.image_url}" class="feedback-image-preview img-trigger-lightbox" style="max-height: 200px; margin: 10px 0; display:block;" alt="截图">`
    : '';

  const heartSvg = `
    <svg class="heart-svg" viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle;">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>
  `;

  // 评论高赞排序列表渲染
  let repliesListHtml = '';
  if (fb.replies && fb.replies.length > 0) {
    repliesListHtml = fb.replies.map(r => {
      const replyDate = new Date(r.created_at).toLocaleString();
      const deleteReplyBtn = (currentUser && (currentUser.role === 'admin' || currentUser.username === r.username))
        ? `<button type="button" class="action-text-btn delete-btn" onclick="deleteReplyDesktop(${r.id}, ${fb.id})" style="font-size:9px; margin-left:6px; color: #ef4444; border:none; background:transparent;">✕ 删除</button>`
        : '';
      const isAdminReply = (r.username === 'niu1029') ? 'admin' : '';

      return `
        <div class="reply-item" style="border-left: 2px solid var(--accent-pink); padding: 8px 12px; background: rgba(0,0,0,0.15); border-radius: 4px; margin-bottom: 8px; text-align: left;">
          <div style="display: flex; justify-content: space-between; font-size: 10.5px; margin-bottom: 4px;">
            <span class="reply-author ${isAdminReply}" style="font-weight:600; color: var(--neon-cyan);">${escapeHTML(r.username)} ${isAdminReply ? '(管理员)' : ''}</span>
            <span style="color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
              ${replyDate} 
              ${deleteReplyBtn}
            </span>
          </div>
          <div class="reply-body" style="font-size: 11.5px; color: var(--text-secondary); margin: 4px 0; word-break: break-all;">${escapeHTML(r.content)}</div>
          <div style="display: flex; justify-content: flex-end; gap: 10px; align-items: center;">
            <button type="button" class="action-text-btn" onclick="focusCommentInputDesktop('${escapeHTML(r.username)}')" style="font-size:10px; color:var(--text-muted); border:none; background:transparent; cursor:pointer;">💬 回复</button>
            <button type="button" class="reply-like-btn ${r.has_liked ? 'liked' : ''}" onclick="toggleLikeReplyDesktop(${r.id}, ${fb.id})" id="reply-like-btn-${r.id}">
              ${heartSvg}
              <span id="reply-like-count-${r.id}">${r.likes_count || 0}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  } else {
    repliesListHtml = `<p style="text-align: center; color: var(--text-muted); font-size: 11px; margin: 20px 0;">🎉 暂无回复，抢占沙发！</p>`;
  }

  const inputAreaHtml = currentUser 
    ? `
      <div class="reply-input-box" style="display: flex; gap: 8px; margin-top: 14px; align-items: center;">
        <textarea id="modal-reply-text-${fb.id}" placeholder="写下您的评论... (点击评论的'回复'可快捷@他人)" class="reply-textarea" style="flex: 1; min-height: 42px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-subtle); color: #fff; padding: 8px; border-radius: 6px; font-size: 12px; resize:none;"></textarea>
        <button type="button" class="btn btn-primary" onclick="submitModalReplyDesktop(${fb.id})" style="height: 42px; padding: 0 16px;">发布</button>
      </div>
    `
    : `<p style="text-align: center; color: var(--text-muted); font-size: 11px; margin-top: 14px;">🔒 请先登录您的账号，登录后即可发表评论。</p>`;

  modalBody.innerHTML = `
    <!-- 帖子头部主帖展示 -->
    <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 12px; text-align: left;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px;">
        <strong style="color: var(--neon-cyan); font-size: 13px;">${escapeHTML(fb.username)}</strong>
        <span style="color: var(--text-muted);">${dateStr}</span>
      </div>
      <p style="color: var(--text-primary); font-size: 13.5px; word-break: break-all; line-height: 1.6; white-space: pre-wrap;">${escapeHTML(fb.content)}</p>
      ${imgTag}
      
      <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
        <button type="button" class="heart-like-btn ${fb.has_liked ? 'liked' : ''}" onclick="toggleLikePostDesktop(${fb.id})" id="detail-like-btn-${fb.id}">
          ${heartSvg}
          <span id="detail-like-count-${fb.id}">${fb.likes_count || 0}</span>
        </button>
      </div>
    </div>

    <!-- 帖子下方的回复评论列表区 -->
    <div style="margin-top: 10px;">
      <h4 style="color: var(--neon-cyan); font-size: 12px; margin-bottom: 10px;">💬 回复评论列表</h4>
      <div class="modal-replies-flow" style="display: flex; flex-direction: column; gap: 8px;">
        ${repliesListHtml}
      </div>
    </div>

    <!-- 评论发布提交区 -->
    ${inputAreaHtml}
  `;

  // 对大图灯箱绑定
  const updatedLightboxImages = modalBody.querySelectorAll('.img-trigger-lightbox');
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxLargeImg = document.getElementById('lightbox-large-img');
  updatedLightboxImages.forEach(img => {
    img.addEventListener('click', () => {
      if (lightboxModal && lightboxLargeImg) {
        lightboxLargeImg.src = img.src;
        lightboxModal.style.display = 'flex';
      }
    });
  });
}

// 聚焦输入框并自动填入回复 @
function focusCommentInputDesktop(username) {
  const ta = document.querySelector('#feedback-detail-modal .reply-textarea');
  if (ta) {
    ta.value = `@${username} `;
    ta.focus();
  }
}
window.focusCommentInputDesktop = focusCommentInputDesktop;

// 提交回复评论
async function submitModalReplyDesktop(feedbackId) {
  if (!currentUser) return;
  const textarea = document.getElementById(`modal-reply-text-${feedbackId}`);
  if (!textarea) return;
  const content = textarea.value.trim();
  if (!content) {
    alert('评论内容不能为空！');
    return;
  }
  try {
    const replyRes = await fetch('https://nhw1029.pages.dev/api/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + currentUser.token
      },
      body: JSON.stringify({ feedback_id: feedbackId, content })
    });
    const replyResult = await replyRes.json();
    if (replyRes.ok && replyResult.success) {
      textarea.value = '';
      logToTerminal(`[Feedback] 成功发表评论 ID: ${feedbackId}`, 'success');
      
      const res = await window.agyHubAPI.fetchFeedbacks();
      if (res.success) {
        window.currentFeedbacksDesktop = res.data;
        const updatedFb = res.data.find(f => f.id === feedbackId);
        if (updatedFb) {
          renderDetailModalContentDesktop(updatedFb);
          const mainCommentCount = document.getElementById(`main-comment-count-${feedbackId}`);
          if (mainCommentCount) {
            mainCommentCount.textContent = updatedFb.replies ? updatedFb.replies.length : 0;
          }
        }
      }
    } else {
      const handled = await handleSessionExpiry(replyResult.error);
      if (!handled) alert(`回复失败: ${replyResult.error}`);
    }
  } catch (err) {
    alert(`系统错误: ${err.message}`);
  }
}
window.submitModalReplyDesktop = submitModalReplyDesktop;

// 删除回复的评论
async function deleteReplyDesktop(replyId, feedbackId) {
  if (!confirm('确定要彻底删除这条回复评论吗？')) return;
  try {
    const replyRes = await fetch(`https://nhw1029.pages.dev/api/reply?id=${replyId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer ' + currentUser.token
      }
    });
    const replyResult = await replyRes.json();
    if (replyRes.ok && replyResult.success) {
      const res = await window.agyHubAPI.fetchFeedbacks();
      if (res.success) {
        window.currentFeedbacksDesktop = res.data;
        const updatedFb = res.data.find(f => f.id === feedbackId);
        if (updatedFb) {
          renderDetailModalContentDesktop(updatedFb);
          const mainCommentCount = document.getElementById(`main-comment-count-${feedbackId}`);
          if (mainCommentCount) {
            mainCommentCount.textContent = updatedFb.replies ? updatedFb.replies.length : 0;
          }
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
}
window.deleteReplyDesktop = deleteReplyDesktop;

// 点赞主卡片
async function toggleLikePostDesktop(id) {
  if (!currentUser) {
    alert('🔒 请先登录您的账号后再进行点赞！');
    return;
  }
  try {
    const response = await fetch('https://nhw1029.pages.dev/api/feedback/like', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + currentUser.token
      },
      body: JSON.stringify({ feedback_id: id })
    });
    const data = await response.json();
    if (response.ok && data.success) {
      const btnMain = document.getElementById(`like-btn-${id}`);
      const countMain = document.getElementById(`like-count-${id}`);
      const btnDetail = document.getElementById(`detail-like-btn-${id}`);
      const countDetail = document.getElementById(`detail-like-count-${id}`);

      if (btnMain && countMain) {
        countMain.textContent = data.likes_count;
        if (data.liked) btnMain.classList.add('liked');
        else btnMain.classList.remove('liked');
      }
      if (btnDetail && countDetail) {
        countDetail.textContent = data.likes_count;
        if (data.liked) btnDetail.classList.add('liked');
        else btnDetail.classList.remove('liked');
      }

      const res = await window.agyHubAPI.fetchFeedbacks();
      if (res.success) {
        window.currentFeedbacksDesktop = res.data;
      }
    }
  } catch (err) {
    console.error(err);
  }
}
window.toggleLikePostDesktop = toggleLikePostDesktop;

// 二级回复点赞
async function toggleLikeReplyDesktop(replyId, feedbackId) {
  if (!currentUser) return;
  try {
    const response = await fetch('https://nhw1029.pages.dev/api/reply/like', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + currentUser.token
      },
      body: JSON.stringify({ reply_id: replyId })
    });
    const data = await response.json();
    if (response.ok && data.success) {
      const btn = document.getElementById(`reply-like-btn-${replyId}`);
      const count = document.getElementById(`reply-like-count-${replyId}`);
      if (btn && count) {
        count.textContent = data.likes_count;
        if (data.liked) btn.classList.add('liked');
        else btn.classList.remove('liked');
      }

      const res = await window.agyHubAPI.fetchFeedbacks();
      if (res.success) {
        window.currentFeedbacksDesktop = res.data;
        const updatedFb = res.data.find(f => f.id === feedbackId);
        if (updatedFb) {
          const modalRepliesFlow = document.querySelector('.modal-replies-flow');
          if (modalRepliesFlow) {
            const heartSvg = `
              <svg class="heart-svg" viewBox="0 0 24 24" width="14" height="14" style="vertical-align: middle;">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            `;
            modalRepliesFlow.innerHTML = updatedFb.replies.map(r => {
              const replyDate = new Date(r.created_at).toLocaleString();
              const deleteReplyBtn = (currentUser && (currentUser.role === 'admin' || currentUser.username === r.username))
                ? `<button type="button" class="action-text-btn delete-btn" onclick="deleteReplyDesktop(${r.id}, ${feedbackId})" style="font-size:9px; margin-left:6px; color: #ef4444; border:none; background:transparent;">✕ 删除</button>`
                : '';
              const isAdminReply = (r.username === 'niu1029') ? 'admin' : '';
              return `
                <div class="reply-item" style="border-left: 2px solid var(--accent-pink); padding: 8px 12px; background: rgba(0,0,0,0.15); border-radius: 4px; margin-bottom: 8px; text-align: left;">
                  <div style="display: flex; justify-content: space-between; font-size: 10.5px; margin-bottom: 4px;">
                    <span class="reply-author ${isAdminReply}" style="font-weight:600; color: var(--neon-cyan);">${escapeHTML(r.username)} ${isAdminReply ? '(管理员)' : ''}</span>
                    <span style="color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
                      ${replyDate} 
                      ${deleteReplyBtn}
                    </span>
                  </div>
                  <div class="reply-body" style="font-size: 11.5px; color: var(--text-secondary); margin: 4px 0; word-break: break-all;">${escapeHTML(r.content)}</div>
                  <div style="display: flex; justify-content: flex-end; gap: 10px; align-items: center;">
                    <button type="button" class="action-text-btn" onclick="focusCommentInputDesktop('${escapeHTML(r.username)}')" style="font-size:10px; color:var(--text-muted); border:none; background:transparent; cursor:pointer;">💬 回复</button>
                    <button type="button" class="reply-like-btn ${r.has_liked ? 'liked' : ''}" onclick="toggleLikeReplyDesktop(${r.id}, ${feedbackId})" id="reply-like-btn-${r.id}">
                      ${heartSvg}
                      <span id="reply-like-count-${r.id}">${r.likes_count || 0}</span>
                    </button>
                  </div>
                </div>
              `;
            }).join('');
          }
        }
      }
    } else {
      const handled = await handleSessionExpiry(data.error);
      if (!handled) alert(`点赞失败: ${data.error}`);
    }
  } catch (err) {
    console.error(err);
  }
}
window.toggleLikeReplyDesktop = toggleLikeReplyDesktop;

// 桌面端专属：云端置顶公告系统 (高斯模糊强弹 + 顶栏常驻)
async function loadAnnouncementSystemDesktop() {
  const modalHTML = `
    <div class="modal-overlay" id="announcement-modal" style="display: none; z-index: 10005;">
      <div class="modal-content" style="width: 480px;">
        <div class="modal-header">
          <div class="modal-logo">
            <span class="pulse-dot"></span>
            <span class="logo-text">📣 系统最新公告</span>
          </div>
          <button class="modal-close-btn" id="btn-close-announcement-modal">✕</button>
        </div>
        <div class="modal-body" id="announcement-modal-body" style="font-size: 13px; line-height: 1.6; color: rgba(255,255,255,0.85); white-space: pre-wrap;">
        </div>
      </div>
    </div>
  `;
  
  if (!document.getElementById('announcement-modal')) {
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  const barHTML = `
    <div class="global-announcement-bar-desktop" id="global-announcement-bar-desktop" style="display: none;">
      <div class="announcement-bar-content-desktop">
        <span class="announcement-bell">📢</span>
        <span class="announcement-text-desktop" id="text-announcement-bar-content-desktop">最新公告加载中...</span>
        <button class="announcement-view-link-desktop" id="btn-reopen-announcement-desktop">点击查看详情 &rarr;</button>
      </div>
    </div>
  `;
  if (!document.getElementById('global-announcement-bar-desktop')) {
    const mainWrapper = document.querySelector('.main-wrapper');
    if (mainWrapper) {
      mainWrapper.insertAdjacentHTML('afterbegin', barHTML);
    } else {
      document.body.insertAdjacentHTML('afterbegin', barHTML);
    }
  }

  const annModal = document.getElementById('announcement-modal');
  const annModalBody = document.getElementById('announcement-modal-body');
  const btnCloseAnnModal = document.getElementById('btn-close-announcement-modal');
  const annBar = document.getElementById('global-announcement-bar-desktop');
  const textAnnBarContent = document.getElementById('text-announcement-bar-content-desktop');
  const btnReopenAnn = document.getElementById('btn-reopen-announcement-desktop');

  if (!annModal || !annModalBody || !annBar) return;

  try {
    const res = await fetch('https://nhw1029.pages.dev/api/announcement');
    if (!res.ok) return;

    const announcement = await res.json();
    if (!announcement) return; // 云端无公告

    // 渲染公告详情内容
    let bodyHtml = `<div>${escapeHTML(announcement.content)}</div>`;
    if (announcement.image_url && announcement.image_url.trim()) {
      bodyHtml += `<img src="${announcement.image_url.trim()}" class="announcement-img-preview img-trigger-lightbox" alt="公告配图" style="cursor: zoom-in;">`;
    }
    annModalBody.innerHTML = bodyHtml;

    // 绑定公告内图片灯箱放大
    const annImages = annModalBody.querySelectorAll('.img-trigger-lightbox');
    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxLargeImg = document.getElementById('lightbox-large-img');
    annImages.forEach(img => {
      img.addEventListener('click', () => {
        if (lightboxModal && lightboxLargeImg) {
          lightboxLargeImg.src = img.src;
          lightboxModal.style.display = 'flex';
        }
      });
    });

    // 展现顶栏常驻条
    textAnnBarContent.textContent = announcement.content;
    annBar.style.display = 'block';

    // 判定强弹
    const lastReadId = localStorage.getItem('read_announcement_id_desktop');
    if (!lastReadId || parseInt(lastReadId) < announcement.id) {
      annModal.style.display = 'flex';
    }

    const closeAnn = () => {
      annModal.style.display = 'none';
      localStorage.setItem('read_announcement_id_desktop', announcement.id.toString());
    };

    if (btnCloseAnnModal) btnCloseAnnModal.addEventListener('click', closeAnn);
    annModal.addEventListener('click', (e) => {
      if (e.target === annModal) closeAnn();
    });

    if (btnReopenAnn) {
      btnReopenAnn.addEventListener('click', () => {
        annModal.style.display = 'flex';
      });
    }

  } catch (e) {
    console.error('公告系统载入失败:', e.message);
  }
}

// 转义 HTML 防止 XSS
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// J.6 载入公告历史列表
async function loadAnnouncementHistory() {
  const container = document.getElementById('admin-ann-history-list');
  if (!container) return;

  container.innerHTML = '<div class="no-data-tip">⏳ 正在读取云端公告历史...</div>';

  try {
    const res = await fetch('https://nhw1029.pages.dev/api/announcement?all=true');
    if (!res.ok) throw new Error('拉取失败');

    const list = await res.json();
    if (!list || list.length === 0) {
      container.innerHTML = '<div class="no-data-tip">🏜️ 暂无历史发布公告。</div>';
      return;
    }

    let html = '';
    list.forEach(ann => {
      const dateText = new Date(ann.created_at).toLocaleString();
      let imageTag = '';
      if (ann.image_url && ann.image_url.trim()) {
        imageTag = `<img src="${ann.image_url.trim()}" class="announcement-img-preview img-trigger-lightbox" alt="公告配图" style="max-height: 120px; object-fit: contain; cursor: zoom-in; margin-top: 8px;">`;
      }

      html += `
        <div class="card" style="border-color: rgba(255,255,255,0.05); padding: 16px; position: relative;">
          <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${dateText}</span>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-edit-ann" data-id="${ann.id}" data-content="${encodeURIComponent(ann.content)}" data-image="${ann.image_url || ''}" style="padding: 2px 8px; font-size: 10px;">📝 编辑</button>
              <button class="btn-delete-fb btn-delete-ann" data-id="${ann.id}" style="padding: 2px 8px; font-size: 10px; color: var(--accent-pink); border-color: rgba(255,0,85,0.2);">🗑️ 删除</button>
            </div>
          </div>
          <div style="font-size: 13px; line-height: 1.6; white-space: pre-wrap; color: rgba(255,255,255,0.85);">${escapeHTML(ann.content)}</div>
          ${imageTag}
        </div>
      `;
    });
    container.innerHTML = html;

    // 绑定编辑和删除按钮
    const editBtns = container.querySelectorAll('.btn-edit-ann');
    editBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const content = decodeURIComponent(btn.getAttribute('data-content'));
        const image = btn.getAttribute('data-image');

        document.getElementById('input-announce-edit-id').value = id;
        document.getElementById('input-announce-content').value = content;
        
        const previewWrapper = document.getElementById('ann-upload-preview-wrapper');
        const previewImg = document.getElementById('img-ann-upload-preview');
        const statusText = document.getElementById('text-ann-upload-status');
        
        if (image && image.trim()) {
          previewImg.src = image.trim();
          previewWrapper.style.display = 'flex';
          statusText.textContent = '原公告图';
        } else {
          previewImg.src = '';
          previewWrapper.style.display = 'none';
        }

        document.getElementById('text-ann-form-title').textContent = '📝 编辑系统公告';
        document.getElementById('btn-cancel-ann-edit').style.display = 'inline-flex';
        
        document.getElementById('tab-admin-announcement').scrollTop = 0;
      });
    });

    const deleteBtns = container.querySelectorAll('.btn-delete-ann');
    deleteBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('⚠️ 确定要从云端删除这条公告吗？物理抹除操作不可逆。')) {
          btn.disabled = true;
          const delRes = await fetch(`https://nhw1029.pages.dev/api/announcement?id=${id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': 'Bearer ' + currentUser.token
            }
          });
          const delResult = await delRes.json();
          if (delRes.ok && delResult.success) {
            logToTerminal(`[Admin] 物理删除公告 ID: ${id}`, 'success');
            loadAnnouncementHistory();
            loadAnnouncementSystemDesktop();
          } else {
            alert(`删除失败: ${delResult.error}`);
            btn.disabled = false;
          }
        }
      });
    });

    // 灯箱
    const previewImages = container.querySelectorAll('.img-trigger-lightbox');
    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxLargeImg = document.getElementById('lightbox-large-img');
    previewImages.forEach(img => {
      img.addEventListener('click', () => {
        if (lightboxModal && lightboxLargeImg) {
          lightboxLargeImg.src = img.src;
          lightboxModal.style.display = 'flex';
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="no-data-tip">❌ 加载历史失败: ${err.message}</div>`;
  }
}

// J.7 展示用户详细页 (及该用户的发言追踪)
async function showAdminUserDetail(username) {
  const listPanel = document.getElementById('admin-users-list-panel');
  const detailPanel = document.getElementById('admin-user-detail-panel');
  const feedbacksContainer = document.getElementById('admin-detail-user-feedbacks');

  if (!listPanel || !detailPanel || !feedbacksContainer) return;

  listPanel.style.display = 'none';
  detailPanel.style.display = 'block';

  document.getElementById('text-detail-username').textContent = `${username}`;
  document.getElementById('input-detail-new-pass').value = '';

  feedbacksContainer.innerHTML = '<div class="no-data-tip">⏳ 正在调取用户发帖历史...</div>';

  try {
    const traceRes = await fetch(`https://nhw1029.pages.dev/api/auth/users?username=${username}`, {
      headers: { 'Authorization': 'Bearer ' + currentUser.token }
    });
    const traceFeedbacks = await traceRes.json();

    if (traceRes.ok) {
      document.getElementById('text-detail-user-stats').textContent = `发表反馈: ${traceFeedbacks.length} 条`;

      if (!traceFeedbacks || traceFeedbacks.length === 0) {
        feedbacksContainer.innerHTML = '<div class="no-data-tip">🏜️ 该用户没有发布过任何反馈。</div>';
        return;
      }

      let traceHtml = '';
      traceFeedbacks.forEach(fb => {
        const dateText = new Date(fb.created_at).toLocaleString();
        let imageTag = '';
        if (fb.image_url && fb.image_url.trim()) {
          imageTag = `<img src="${fb.image_url.trim()}" class="feedback-image-preview img-trigger-lightbox" alt="用户反馈截图" loading="lazy">`;
        }
        traceHtml += `
          <div class="feedback-item">
            <div class="feedback-meta">
              <span class="feedback-author">${username}</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="feedback-date">${dateText}</span>
                <button class="btn-delete-fb btn-detail-delete-fb" data-id="${fb.id}">🗑️ 删除</button>
              </div>
            </div>
            <div class="feedback-body">${escapeHTML(fb.content)}</div>
            ${imageTag}
          </div>
        `;
      });
      feedbacksContainer.innerHTML = traceHtml;

      const deleteButtons = feedbacksContainer.querySelectorAll('.btn-detail-delete-fb');
      deleteButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
          const fbId = btn.getAttribute('data-id');
          if (confirm('⚠️ 警告：物理级级联删除操作不可逆，将连同该留言下所有二级回复一并清理！是否确认删除？')) {
            btn.disabled = true;
            const delRes = await window.agyHubAPI.deleteFeedback(fbId);
            if (delRes.success) {
              logToTerminal(`[Admin] 物理删除用户 @${username} 的留言 ID: ${fbId}`, 'success');
              showAdminUserDetail(username);
              loadFeedbacks();
            } else {
              alert(`删除失败: ${delRes.error}`);
              btn.disabled = false;
            }
          }
        });
      });

      const lightboxModal = document.getElementById('lightbox-modal');
      const lightboxLargeImg = document.getElementById('lightbox-large-img');
      const previewImages = feedbacksContainer.querySelectorAll('.img-trigger-lightbox');
      previewImages.forEach(img => {
        img.addEventListener('click', () => {
          if (lightboxModal && lightboxLargeImg) {
            lightboxLargeImg.src = img.src;
            lightboxModal.style.display = 'flex';
          }
        });
      });

    } else {
      feedbacksContainer.innerHTML = `<div class="no-data-tip">❌ 无法获取用户发言记录: ${traceFeedbacks.error}</div>`;
    }
  } catch (err) {
    feedbacksContainer.innerHTML = `<div class="no-data-tip">❌ 获取数据发生错误: ${err.message}</div>`;
  }
}

// 自动加载初始化极客看板
initFeedbackBoard();

// ==========================================
// 10. 关联/添加新账号 Modal 交互驱动
// ==========================================
const btnAddLocalAccount = document.getElementById('btn-add-local-account');
const addAccountModal = document.getElementById('add-account-modal');
const btnCloseAddAccountModal = document.getElementById('btn-close-add-account-modal');

const btnAddTabOfficial = document.getElementById('btn-add-tab-official');
const btnAddTabJson = document.getElementById('btn-add-tab-json');
const panelAddOfficial = document.getElementById('panel-add-official');
const panelAddJson = document.getElementById('panel-add-json');

const btnStartOauth = document.getElementById('btn-start-oauth');
const btnCopyOauthUrl = document.getElementById('btn-copy-oauth-url');
const btnSubmitOauthCode = document.getElementById('btn-submit-oauth-code');
const btnImportJsonFile = document.getElementById('btn-import-json-file');

const oauthLinkGroup = document.getElementById('oauth-link-group');
const inputOauthUrl = document.getElementById('input-oauth-url');
const inputOauthCode = document.getElementById('input-oauth-code');
const oauthStatusMessage = document.getElementById('oauth-status-message');

if (btnAddLocalAccount && addAccountModal && btnCloseAddAccountModal) {
  // 打开 Modal
  btnAddLocalAccount.addEventListener('click', () => {
    addAccountModal.style.display = 'flex';
    switchAddTab('official');
  });

  // 关闭 Modal
  const closeAddAccModal = () => {
    addAccountModal.style.display = 'none';
    if (inputOauthCode) inputOauthCode.value = '';
    if (inputOauthUrl) inputOauthUrl.value = '';
    if (oauthLinkGroup) oauthLinkGroup.style.display = 'none';
    if (oauthStatusMessage) oauthStatusMessage.textContent = '';
  };
  btnCloseAddAccountModal.addEventListener('click', closeAddAccModal);

  // 两选项卡切换
  function switchAddTab(tab) {
    [btnAddTabOfficial, btnAddTabJson].forEach(btn => {
      if (btn) {
        btn.classList.remove('active');
        btn.style.borderBottom = '2px solid transparent';
        btn.style.color = 'var(--text-dim)';
        btn.style.fontWeight = 'normal';
      }
    });
    [panelAddOfficial, panelAddJson].forEach(panel => {
      if (panel) panel.style.display = 'none';
    });

    if (tab === 'official') {
      if (btnAddTabOfficial) {
        btnAddTabOfficial.classList.add('active');
        btnAddTabOfficial.style.borderBottom = '2px solid var(--accent-cyan)';
        btnAddTabOfficial.style.color = 'var(--text-main)';
        btnAddTabOfficial.style.fontWeight = 'bold';
      }
      if (panelAddOfficial) panelAddOfficial.style.display = 'block';
    } else if (tab === 'json') {
      if (btnAddTabJson) {
        btnAddTabJson.classList.add('active');
        btnAddTabJson.style.borderBottom = '2px solid var(--accent-cyan)';
        btnAddTabJson.style.color = 'var(--text-main)';
        btnAddTabJson.style.fontWeight = 'bold';
      }
      if (panelAddJson) panelAddJson.style.display = 'block';
    }
  }

  if (btnAddTabOfficial && btnAddTabJson) {
    btnAddTabOfficial.addEventListener('click', () => switchAddTab('official'));
    btnAddTabJson.addEventListener('click', () => switchAddTab('json'));
  }

  // 1. 网页一键登录：开始 OAuth 授权流程
  if (btnStartOauth) {
    btnStartOauth.addEventListener('click', async () => {
      btnStartOauth.disabled = true;
      btnStartOauth.textContent = '🌐 正在启动授权流程...';
      if (oauthStatusMessage) oauthStatusMessage.textContent = '正在获取 Google 授权链接...';
      try {
        const res = await window.agyHubAPI.startOauthLogin();
        if (res && res.success) {
          if (oauthLinkGroup) oauthLinkGroup.style.display = 'block';
          if (inputOauthUrl) inputOauthUrl.value = res.authUrl;
          if (oauthStatusMessage) oauthStatusMessage.textContent = '🔑 请在自动打开的浏览器网页中完成 Google 授权登录。';
          logToTerminal('[Account] 已成功拉起系统默认浏览器进行 Google 授权登录。', 'success');
        } else {
          alert('启动 OAuth 授权失败: ' + (res?.error || '未知错误'));
          if (oauthStatusMessage) oauthStatusMessage.textContent = '授权获取失败，请重试。';
        }
      } catch (err) {
        alert('启动授权发生异常: ' + err.message);
      } finally {
        btnStartOauth.disabled = false;
        btnStartOauth.textContent = '🌐 重新开始 OAuth 授权';
      }
    });
  }

  // 2. 复制授权链接
  if (btnCopyOauthUrl && inputOauthUrl) {
    btnCopyOauthUrl.addEventListener('click', () => {
      navigator.clipboard.writeText(inputOauthUrl.value);
      const oldTxt = btnCopyOauthUrl.textContent;
      btnCopyOauthUrl.textContent = '已复制';
      setTimeout(() => {
        btnCopyOauthUrl.textContent = oldTxt;
      }, 1500);
    });
  }

  // 执行核心 Code 兑换逻辑
  async function performCodeExchange(codeValue) {
    if (oauthStatusMessage) oauthStatusMessage.textContent = '⚡ 正在向 Google 服务器兑换并导入 Token...';
    try {
      const aRes = await window.agyHubAPI.submitOauthCode(codeValue);
      if (aRes && aRes.success) {
        logToTerminal(`[Account] 网页授权成功！导入谷歌账号: ${aRes.email}，已设为当前激活账号！`, 'success');
        closeAddAccModal();
        await loadLocalAccounts();
      } else {
        alert('导入账号失败: ' + (aRes?.error || '未知错误'));
        if (oauthStatusMessage) oauthStatusMessage.textContent = '❌ Token 兑换失败，请重新授权。';
      }
    } catch (err) {
      alert('兑换 Token 发生异常: ' + err.message);
    }
  }

  // 3. 手动粘贴链接或 Code 提交
  if (btnSubmitOauthCode && inputOauthCode) {
    btnSubmitOauthCode.addEventListener('click', async () => {
      const codeVal = inputOauthCode.value.trim();
      if (!codeVal) {
        alert('请先输入重定向回调链接或授权 Code！');
        return;
      }
      btnSubmitOauthCode.disabled = true;
      btnSubmitOauthCode.textContent = '提交中...';
      await performCodeExchange(codeVal);
      btnSubmitOauthCode.disabled = false;
      btnSubmitOauthCode.textContent = '提交';
    });
  }

  // 4. 自动捕获主进程截获的回调 Code，实现瞬间静默登录！
  window.agyHubAPI.onOauthCodeCaptured(async ({ code }) => {
    logToTerminal('[Account] 检测到本地服务器已自动拦截 Google 授权回调，正在极速换取 Token...', 'info');
    await performCodeExchange(code);
  });

  // 方式二：导入 JSON 配置文件
  if (btnImportJsonFile) {
    btnImportJsonFile.addEventListener('click', async () => {
      btnImportJsonFile.disabled = true;
      btnImportJsonFile.textContent = '📥 正在等待选择文件...';
      try {
        const iRes = await window.agyHubAPI.importLocalAccountFile();
        if (iRes && iRes.success) {
          logToTerminal(`[Account] 成功从本地配置文件导入账号: ${iRes.email}`, 'success');
          closeAddAccModal();
          await loadLocalAccounts();
        } else if (iRes && iRes.code === 'CANCELED') {
          // 静默
        } else {
          alert('导入失败: ' + (iRes?.error || '文件解析错误'));
        }
      } catch (err) {
        alert('导入异常: ' + err.message);
      } finally {
        btnImportJsonFile.disabled = false;
        btnImportJsonFile.textContent = '📥 选择本地账号 JSON 配置文件';
      }
    });
  }
}

// ==========================================
// 11. Token 监控大屏逻辑
// ==========================================
async function initTokenMonitor() {
  const statTotal = document.getElementById('stat-total-token');
  const statHitRate = document.getElementById('stat-cache-hit-rate');
  const statCached = document.getElementById('stat-cached-token');
  const statOutput = document.getElementById('stat-output-token');
  const logList = document.getElementById('token-log-list');
  const inputUpstream = document.getElementById('input-proxy-upstream');
  const btnApply = document.getElementById('btn-proxy-apply');
  
  // Tab 切换逻辑
  const btnTabAccounts = document.getElementById('btn-la-tab-accounts');
  const btnTabToken = document.getElementById('btn-la-tab-token');
  const panelAccounts = document.getElementById('panel-la-accounts');
  const panelToken = document.getElementById('panel-la-token');

  const monitorStatus = document.createElement('div');
  monitorStatus.id = 'token-monitor-status';
  monitorStatus.style.cssText = 'display:flex;align-items:center;gap:7px;margin:0 0 10px;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:6px;font-size:11px;color:var(--text-dim);background:rgba(255,255,255,0.025);';
  if (panelToken) panelToken.insertBefore(monitorStatus, panelToken.children[1] || null);

  async function refreshMonitorStatus() {
    if (!window.agyHubAPI.getTokenMonitorStatus) return;
    try {
      const status = await window.agyHubAPI.getTokenMonitorStatus();
      const localActive = Boolean(status.localMonitor && status.localMonitor.ready);
      const proxyActive = Boolean(status.ready && status.routed);
      const active = localActive || proxyActive;
      const color = active ? '#52c49c' : '#fbd160';
      const label = localActive
        ? `本地实时估算已启动（监听 ${status.localMonitor.watchedFiles || 0} 个会话，无需重启 Antigravity）`
        : proxyActive
          ? '官方 Token 流量监控已接管 Antigravity'
        : (status.ready ? '代理已就绪，请重启 Antigravity 以接管对话流量' : 'Token 代理未监听');
      monitorStatus.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};flex:none;"></span><span>${label}</span>`;
      monitorStatus.style.borderColor = `${color}55`;
    } catch (error) {
      monitorStatus.textContent = `监控状态读取失败：${error.message}`;
    }
  }

  if (btnTabAccounts && btnTabToken) {
    function switchLaTab(tab) {
      if (tab === 'accounts') {
        btnTabAccounts.classList.add('active');
        btnTabAccounts.style.background = 'var(--bg-card)';
        btnTabAccounts.style.color = 'var(--text-main)';
        
        btnTabToken.classList.remove('active');
        btnTabToken.style.background = 'transparent';
        btnTabToken.style.color = 'var(--text-dim)';
        
        panelAccounts.style.display = 'flex';
        panelToken.style.display = 'none';
      } else {
        btnTabToken.classList.add('active');
        btnTabToken.style.background = 'var(--bg-card)';
        btnTabToken.style.color = 'var(--text-main)';
        
        btnTabAccounts.classList.remove('active');
        btnTabAccounts.style.background = 'transparent';
        btnTabAccounts.style.color = 'var(--text-dim)';
        
        panelToken.style.display = 'flex';
        panelAccounts.style.display = 'none';
      }
    }
    btnTabAccounts.addEventListener('click', () => switchLaTab('accounts'));
    btnTabToken.addEventListener('click', () => switchLaTab('token'));
  }

  if (!statTotal) return;

  function updateDashboard(stats) {
    if (!stats) return;
    statTotal.textContent = (stats.totalTokens || 0).toLocaleString();
    statCached.textContent = (stats.cachedTokens || 0).toLocaleString();
    statOutput.textContent = (stats.completionTokens || 0).toLocaleString();
    
    let hitRate = 0;
    if (stats.promptTokens > 0) {
      hitRate = (stats.cachedTokens / stats.promptTokens) * 100;
    }
    statHitRate.textContent = hitRate.toFixed(1) + '%';
    const fill = document.getElementById('cache-rate-fill');
    if (fill) {
      fill.style.width = Math.min(100, Math.max(0, hitRate)).toFixed(1) + '%';
    }
  }

  // --- 新增状态控制 ---
  window.globalTokenLogs = [];
  window.currentFilter = 'all';
  window.currentPage = 1;
  window.pageSize = 40;
  window.globalTokenStatsRaw = null;

  function renderLogList() {
    const logList = document.getElementById('token-log-list');
    if (!logList) return;

    // 1. Normalize and merge
    const normalized = window.globalTokenLogs.map(log => {
        if (log.type === 'res' || log.input !== undefined) {
             return {
                 type: 'res',
                 timestamp: log.time || log.timestamp,
                 duration: log.duration || 0,
                 promptTokens: log.input !== undefined ? log.input : (log.promptTokens || 0),
                 completionTokens: log.output !== undefined ? log.output : (log.completionTokens || 0),
                 cachedTokens: log.cached !== undefined ? log.cached : (log.cachedTokens || 0),
                 estimated: log.estimated,
                 source: log.source
             };
        }
        return log;
    });

    // 智能合并算法
    const arr = [...normalized].reverse();
    const merged = [];
    for (const log of arr) {
        if (log.type === 'res' && log.source === 'local-transcript') {
            if (log.promptTokens === 0) {
                if (merged.length > 0) {
                    const last = merged[merged.length - 1];
                    if (last.type === 'res' && last.source === 'local-transcript') {
                        last.completionTokens = (last.completionTokens || 0) + (log.completionTokens || 0);
                        continue;
                    }
                }
            }
        }
        merged.push({ ...log });
    }
    let processed = merged.reverse();

    // 2. Filter by Time
    const now = new Date();
    processed = processed.filter(log => {
        if (!log.timestamp) return true;
        const time = new Date(log.timestamp);
        if (window.currentFilter === 'hour') return now - time <= 3600000;
        if (window.currentFilter === 'day') return time.getFullYear() === now.getFullYear() && time.getMonth() === now.getMonth() && time.getDate() === now.getDate();
        if (window.currentFilter === 'week') {
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            const startOfWeek = new Date(now.setDate(diff));
            startOfWeek.setHours(0,0,0,0);
            return time >= startOfWeek;
        }
        if (window.currentFilter === 'month') return time.getFullYear() === now.getFullYear() && time.getMonth() === now.getMonth();
        return true;
    });

    // 3. Update Dashboard
    if (window.currentFilter === 'all' && window.globalTokenStatsRaw) {
        updateDashboard(window.globalTokenStatsRaw);
    } else {
        let tInput = 0, tOutput = 0, tCached = 0;
        for (const log of processed) {
            if (log.type === 'res') {
                tInput += log.promptTokens || 0;
                tOutput += log.completionTokens || 0;
                tCached += log.cachedTokens || 0;
            }
        }
        updateDashboard({
            totalTokens: tInput + tOutput,
            promptTokens: tInput,
            completionTokens: tOutput,
            cachedTokens: tCached
        });
    }

    // 4. Pagination
    const totalItems = processed.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / window.pageSize));
    if (window.currentPage > totalPages) window.currentPage = totalPages;
    
    const startIndex = (window.currentPage - 1) * window.pageSize;
    const paginated = processed.slice(startIndex, startIndex + window.pageSize);
    
    // 5. Render DOM
    logList.innerHTML = '';
    if (paginated.length === 0) {
        logList.innerHTML = `<div style="font-size: 11px; color: var(--text-dim); text-align: center; margin-top: 20px;">暂无满足条件的日志</div>`;
    } else {
        paginated.forEach(log => {
            const div = document.createElement('div');
            div.style.cssText = 'background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border-left: 2px solid var(--accent-cyan); font-size: 11px; line-height: 1.5; margin-bottom: 8px;';
            const timeStr = new Date(log.timestamp).toLocaleTimeString();
            let details = '';
            if (log.type === 'req') {
                details = `<span style="color:var(--text-dim);">[Req]</span> ${log.url}`;
            } else if (log.type === 'res') {
                const estimateMark = log.estimated ? '≈' : '';
                const isLocal = log.source === 'local-transcript';
                const sourceLabel = isLocal ? '本地实时估算' : (log.source === 'manual' ? '手动' : (log.estimated ? '代理估算' : '官方'));
                const duration = isLocal ? '' : `耗时: ${log.duration}ms | `;
                details = `<span style="color:#fbd160;">[Res/${sourceLabel}]</span> ${duration}输入: ${estimateMark}${log.promptTokens} (缓存:${log.cachedTokens}) | 输出: ${estimateMark}${log.completionTokens}`;
            } else {
                details = log.message;
            }
            div.innerHTML = `<span style="color:var(--text-dim); margin-right:8px;">[${timeStr}]</span> ${details}`;
            logList.appendChild(div);
        });
    }
    
    // 6. Update Pagination UI
    const info = document.getElementById('token-page-info');
    const btnPrev = document.getElementById('btn-page-prev');
    const btnNext = document.getElementById('btn-page-next');
    if (info) info.textContent = `共 ${totalItems} 条，第 ${window.currentPage} / ${totalPages} 页`;
    if (btnPrev) btnPrev.disabled = window.currentPage <= 1;
    if (btnNext) btnNext.disabled = window.currentPage >= totalPages;
  }

  // --- 初始化事件监听 ---
  setTimeout(() => {
      const filterTabs = document.querySelectorAll('.filter-tab');
      filterTabs.forEach(tab => {
          tab.addEventListener('click', (e) => {
              filterTabs.forEach(t => {
                  t.classList.remove('active');
                  t.style.background = 'transparent';
                  t.style.color = 'var(--text-dim)';
              });
              e.target.classList.add('active');
              e.target.style.background = 'var(--bg-card)';
              e.target.style.color = 'var(--text-main)';
              
              window.currentFilter = e.target.dataset.filter;
              window.currentPage = 1;
              renderLogList();
          });
      });

      const btnPrev = document.getElementById('btn-page-prev');
      const btnNext = document.getElementById('btn-page-next');
      if (btnPrev) {
          btnPrev.addEventListener('click', () => {
              if (window.currentPage > 1) {
                  window.currentPage--;
                  renderLogList();
              }
          });
      }
      if (btnNext) {
          btnNext.addEventListener('click', () => {
              window.currentPage++;
              renderLogList();
          });
      }
  }, 100);


  try {
    const stats = await window.agyHubAPI.getTokenStats();
    if (stats) {
        window.globalTokenStatsRaw = stats;
        window.globalTokenLogs = stats.logs || [];
        renderLogList();
    }
  } catch(e) {
    console.error('Failed to init token stats:', e);
  }

  await refreshMonitorStatus();
  setInterval(async () => {
    try {
      const stats = await window.agyHubAPI.getTokenStats();
      if (stats) {
         window.globalTokenStatsRaw = stats;
         if (window.currentFilter === 'all') {
             updateDashboard(stats);
         }
      }
    } catch (error) {}
  }, 1500);
  setInterval(refreshMonitorStatus, 3000);

  if (window.agyHubAPI.onTokenLogUpdate) {
    window.agyHubAPI.onTokenLogUpdate((data) => {
      if (data.type === 'stats') {
         window.globalTokenStatsRaw = data.stats;
         if (window.currentFilter === 'all') {
             updateDashboard(data.stats);
         }
      } else {
         window.globalTokenLogs.unshift(data);
         if (window.globalTokenLogs.length > 500) {
             window.globalTokenLogs = window.globalTokenLogs.slice(0, 500);
         }
         renderLogList();
      }
    });
  }

  const btnRefreshStats = document.getElementById('btn-refresh-token-stats');
  if (btnRefreshStats) {
    btnRefreshStats.addEventListener('click', async () => {
      const spinIcon = document.getElementById('icon-refresh-token-spin');
      if (spinIcon) spinIcon.style.transition = 'transform 0.5s ease';
      if (spinIcon) spinIcon.style.transform = 'rotate(360deg)';
      btnRefreshStats.disabled = true;
      try {
        const stats = await window.agyHubAPI.getTokenStats();
        if (stats) {
          window.globalTokenStatsRaw = stats;
          window.globalTokenLogs = stats.logs || [];
          renderLogList();
        }
      } catch(e) {
        console.error('Manual refresh stats error:', e);
      } finally {
        setTimeout(() => {
          if (spinIcon) spinIcon.style.transform = 'rotate(0deg)';
          btnRefreshStats.disabled = false;
        }, 500);
      }
    });
  }

  if (btnApply) {
    btnApply.addEventListener('click', async () => {
      const upstream = inputUpstream.value.trim();
      if (!upstream) return alert('请输入有效的上游地址');
      btnApply.disabled = true;
      btnApply.textContent = '应用中...';
      try {
        await window.agyHubAPI.startTokenProxy(31000, upstream);
        logToTerminal('[Proxy] 代理转发目标已设置并激活: ' + upstream, 'success');
        btnApply.textContent = '✓ 已生效';
        btnApply.style.backgroundColor = 'rgba(0, 255, 204, 0.15)';
        btnApply.style.borderColor = '#00ffcc';
        btnApply.style.color = '#00ffcc';
      } catch(e) {
        alert('应用失败: ' + e.message);
        btnApply.textContent = '应用';
      } finally {
        btnApply.disabled = false;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTokenMonitor();

  // ----------------------------------------
  // 自动更新逻辑 (electron-updater)
  // ----------------------------------------
  const btnCheckUpdate = document.getElementById('btn-check-update');
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', async () => {
      btnCheckUpdate.disabled = true;
      btnCheckUpdate.textContent = '🔄 检查中...';
      try {
        const res = await window.agyHubAPI.checkAppUpdate();
        if (!res.success) {
          alert('检查更新提示: ' + (res.error || '无法连接 GitHub Release'));
          btnCheckUpdate.disabled = false;
          btnCheckUpdate.textContent = '🚀 检查更新';
        }
      } catch (e) {
        alert('检查更新异常: ' + e.message);
        btnCheckUpdate.disabled = false;
        btnCheckUpdate.textContent = '🚀 检查更新';
      }
    });
  }

  if (window.agyHubAPI && window.agyHubAPI.onUpdaterMessage) {
    window.agyHubAPI.onUpdaterMessage((data) => {
      console.log('[Updater]', data);
      const btn = document.getElementById('btn-check-update');
      if (!btn) return;
      
      if (data.status === 'checking') {
        btn.textContent = '🔄 检查中...';
        btn.disabled = true;
      } else if (data.status === 'available') {
        btn.textContent = `📥 下载 v${data.version}`;
        btn.disabled = false;
        btn.style.background = 'linear-gradient(135deg, #00b4db, #0083b0)';
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = '⏳ 开始下载...';
          await window.agyHubAPI.startDownloadUpdate();
        };
      } else if (data.status === 'not-available') {
        btn.textContent = '✅ 已是最新版';
        btn.disabled = false;
        setTimeout(() => { btn.textContent = '🚀 检查更新'; }, 3000);
      } else if (data.status === 'downloading') {
        btn.textContent = `⏬ 已下载 ${data.percent}%`;
        btn.disabled = true;
      } else if (data.status === 'downloaded') {
        btn.textContent = '✨ 立即重启覆盖安装';
        btn.disabled = false;
        btn.style.background = 'linear-gradient(135deg, #11998e, #38ef7d)';
        btn.onclick = () => {
          window.agyHubAPI.quitAndInstallUpdate();
        };
      } else if (data.status === 'error') {
        alert('更新提醒: ' + data.text);
        btn.textContent = '🚀 检查更新';
        btn.disabled = false;
      }
    });
  }
  // ----------------------------------------
  // 窗口全屏/还原按钮 (btn-maximize)
  // ----------------------------------------
  const btnMaximize = document.getElementById('btn-maximize');
  if (btnMaximize) {
    btnMaximize.addEventListener('click', () => {
      if (window.agyHubAPI && window.agyHubAPI.maximizeWindow) {
        window.agyHubAPI.maximizeWindow();
      }
    });
  }

  // ----------------------------------------
  // 亮色/暗色主题切换 (btn-toggle-light-dark)
  // ----------------------------------------
  const btnToggleLightDark = document.getElementById('btn-toggle-light-dark');
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');

  // 初始化上次选择的主题
  const savedThemeMode = localStorage.getItem('agy_hub_color_theme');
  if (savedThemeMode === 'light') {
    document.body.classList.add('light-theme');
    if (sunIcon && moonIcon) {
      sunIcon.style.display = 'inline';
      moonIcon.style.display = 'none';
    }
  }

  if (btnToggleLightDark) {
    btnToggleLightDark.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-theme');
      if (isLight) {
        localStorage.setItem('agy_hub_color_theme', 'light');
        if (sunIcon && moonIcon) {
          sunIcon.style.display = 'inline';
          moonIcon.style.display = 'none';
        }
      } else {
        localStorage.setItem('agy_hub_color_theme', 'dark');
        if (sunIcon && moonIcon) {
          sunIcon.style.display = 'none';
          moonIcon.style.display = 'inline';
        }
      }
    });
  }
});
