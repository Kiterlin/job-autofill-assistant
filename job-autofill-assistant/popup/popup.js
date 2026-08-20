// ============================================================================
// Popup 交互逻辑 - 晶莹毛玻璃·高级质感版
// ============================================================================

let currentProfile = null;
let allProfiles = [];
let activeProfileId = null;

// ============================================================================
// 初始化
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Popup] 初始化');
  if (typeof appLog !== 'undefined') {
    appLog.info('popup', 'page.init', '弹窗已打开');
    appLog.watchClicks(document);
  }
  await initTheme();
  await loadProfiles();
  bindEvents();
  updateStatus();
});

function preferredTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

async function initTheme() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      const saved = response && response.success ? response.settings?.uiTheme : '';
      applyTheme(saved || preferredTheme());
      resolve();
    });
  });
}

async function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  chrome.runtime.sendMessage({ action: 'updateSettings', settings: { uiTheme: next } });
}

// ============================================================================
// 数据加载
// ============================================================================

async function loadProfiles() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getAllProfiles' }, (response) => {
      if (response && response.success) {
        allProfiles = response.profiles || [];
        activeProfileId = response.activeProfileId;

        // 填充隐式下拉框（保留兼容）
        const select = document.getElementById('profileSelect');
        if (select) {
          select.innerHTML = '';
          if (allProfiles.length === 0) {
            select.innerHTML = '<option value="">暂无简历资料</option>';
          } else {
            allProfiles.forEach(profile => {
              const option = document.createElement('option');
              option.value = profile.id;
              option.textContent = profile.name;
              if (profile.id === activeProfileId) {
                option.selected = true;
              }
              select.appendChild(option);
            });
          }
        }

        // 加载当前激活的资料
        currentProfile = allProfiles.find(p => p.id === activeProfileId) || allProfiles[0] || null;

        // 渲染苹果风自定义下拉菜单
        renderCustomDropdown();
      }
      resolve();
    });
  });
}

function renderCustomDropdown() {
  const nameLabel = document.getElementById('selectedProfileName');
  const menu = document.getElementById('profileDropdownMenu');
  if (!nameLabel || !menu) return;

  if (!currentProfile) {
    nameLabel.textContent = '暂无简历资料';
    menu.innerHTML = '<div class="dropdown-item" style="color:var(--text-muted);">暂无简历资料</div>';
    return;
  }

  nameLabel.textContent = currentProfile.name || '默认资料';
  menu.innerHTML = '';

  allProfiles.forEach(profile => {
    const isAct = profile.id === currentProfile.id;
    const item = document.createElement('div');
    item.className = 'dropdown-item' + (isAct ? ' active' : '');
    item.innerHTML = `
      <span>${profile.name}</span>
      ${isAct ? '<span class="check-icon">✓</span>' : ''}
    `;
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeCustomDropdown();
      if (profile.id !== currentProfile.id) {
        await switchProfile(profile.id);
        updateStatus();
      }
    });
    menu.appendChild(item);
  });
}

function toggleCustomDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('profileDropdown');
  if (dropdown) {
    dropdown.classList.toggle('is-open');
  }
}

function closeCustomDropdown() {
  const dropdown = document.getElementById('profileDropdown');
  if (dropdown) {
    dropdown.classList.remove('is-open');
  }
}

// ============================================================================
// 事件绑定
// ============================================================================

function bindEvents() {
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
  }

  // 苹果风自定义下拉触发
  const dropdownBtn = document.getElementById('profileDropdownBtn');
  if (dropdownBtn) {
    dropdownBtn.addEventListener('click', toggleCustomDropdown);
  }

  // 点击外部关闭下拉菜单
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown && !dropdown.contains(e.target)) {
      closeCustomDropdown();
    }
  });

  // 资料切换 (隐式 select 联动)
  const profileSelect = document.getElementById('profileSelect');
  if (profileSelect) {
    profileSelect.addEventListener('change', async (e) => {
      const profileId = e.target.value;
      if (!profileId) return;
      await switchProfile(profileId);
      updateStatus();
    });
  }

  // 重命名资料
  const renameProfileBtn = document.getElementById('renameProfileBtn');
  if (renameProfileBtn) {
    renameProfileBtn.addEventListener('click', async () => {
      if (!currentProfile) {
        showToast('当前没有选中的资料', 'warning');
        return;
      }
      const oldName = currentProfile.name || '默认资料';
      const newName = await showApplePrompt({
        title: '重命名资料档案',
        subtitle: '修改此份简历的名称，便于在投递不同岗位时快速识别',
        defaultValue: oldName,
        placeholder: '例如：前端开发版 / 字节专版',
        confirmText: '保存名称'
      });
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) {
        showToast('资料名称不能为空', 'warning');
        return;
      }
      if (trimmed === oldName) return;

      chrome.runtime.sendMessage({
        action: 'updateProfile',
        profileId: activeProfileId,
        updates: { name: trimmed }
      }, async (response) => {
        if (response && response.success) {
          await loadProfiles();
          updateStatus();
          showToast(`✅ 资料已重命名为: 「${trimmed}」`, 'success');
        } else {
          showToast('重命名失败，请重试', 'error');
        }
      });
    });
  }

  // 新增资料
  const addProfileBtn = document.getElementById('addProfileBtn');
  if (addProfileBtn) {
    addProfileBtn.addEventListener('click', async () => {
      const name = await showApplePrompt({
        title: '新建简历资料档案',
        subtitle: '为新的求职方向创建独立资料卡（如：产品运营 / 英文简历）',
        defaultValue: `资料 ${allProfiles.length + 1}`,
        placeholder: '请输入新资料名称',
        confirmText: '创建资料'
      });
      if (!name || !name.trim()) return;

      chrome.runtime.sendMessage({ action: 'addProfile', name: name.trim() }, async (response) => {
        if (response && response.success) {
          await loadProfiles();
          updateStatus();
          showToast('新资料已创建', 'success');
        } else {
          showToast('创建失败，请重试', 'error');
        }
      });
    });
  }

  // 填充按钮
  const fillBtn = document.getElementById('fillBtn');
  if (fillBtn) {
    fillBtn.addEventListener('click', fillCurrentPage);
  }

  // 配置按钮 - 打开配置页面
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    });
  }

  // 导出数据
  const exportLink = document.getElementById('exportLink');
  if (exportLink) {
    exportLink.addEventListener('click', (e) => {
      e.preventDefault();
      exportData();
    });
  }

  // 导入数据
  const importLink = document.getElementById('importLink');
  if (importLink) {
    importLink.addEventListener('click', (e) => {
      e.preventDefault();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = importData;
      input.click();
    });
  }

  // 帮助
  const helpLink = document.getElementById('helpLink');
  if (helpLink) {
    helpLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#help') });
    });
  }

  // 投递看板链接
  const viewHistoryLink = document.getElementById('viewHistoryLink');
  if (viewHistoryLink) {
    viewHistoryLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#kanban') });
    });
  }
}

// ============================================================================
// 核心功能
// ============================================================================

async function switchProfile(profileId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'setActiveProfile', profileId }, (response) => {
      if (response && response.success) {
        activeProfileId = profileId;
        currentProfile = allProfiles.find(p => p.id === profileId);
        showToast('已切换资料', 'success');
      }
      resolve();
    });
  });
}

async function fillCurrentPage() {
  if (!currentProfile) {
    showToast('请先配置简历资料', 'warning');
    if (typeof appLog !== 'undefined') appLog.warn('popup', 'fill.skip', '未配置资料，取消填充');
    return;
  }
  if (typeof appLog !== 'undefined') {
    appLog.info('popup', 'fill.start', '开始填充当前页面', { profile: currentProfile.name });
  }

  const btn = document.getElementById('fillBtn');
  const loading = document.getElementById('loadingState');

  if (btn) btn.disabled = true;
  if (loading) loading.style.display = 'flex';

  try {
    // 获取当前标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      if (btn) btn.disabled = false;
      if (loading) loading.style.display = 'none';
      showToast('未找到有效页面', 'error');
      return;
    }

    // 检查是否是特殊页面（chrome://、edge://等）
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://'))) {
      if (btn) btn.disabled = false;
      if (loading) loading.style.display = 'none';
      showToast('无法在系统内置页面中使用', 'error');
      return;
    }

    // 先尝试注入 content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['scripts/content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['styles/content.css']
      });
      await new Promise(resolve => setTimeout(resolve, 120));
    } catch (e) {
      console.log('[Popup] Content script 注入略过或已存在:', e);
    }

    // 发送消息到 content script
    chrome.tabs.sendMessage(tab.id, {
      action: 'fillForm',
      profile: currentProfile
    }, (response) => {
      if (btn) btn.disabled = false;
      if (loading) loading.style.display = 'none';

      if (chrome.runtime.lastError) {
        console.error('[Popup] 消息发送失败:', chrome.runtime.lastError);
        if (typeof appLog !== 'undefined') appLog.error('popup', 'fill.fail', '无法联系页面脚本', chrome.runtime.lastError.message);
        showToast('请刷新目标页面后重试', 'warning');
        return;
      }

      if (response && response.success) {
        const count = response.result?.filledCount || 0;
        if (typeof appLog !== 'undefined') appLog.success('popup', 'fill.done', `填充成功，${count} 个字段`);
        showToast(`✨ 成功智能填充 ${count} 个字段`, 'success');
        updateLastUsed();
      } else {
        if (typeof appLog !== 'undefined') appLog.warn('popup', 'fill.empty', '未检测到可匹配的表单字段');
        showToast('未检测到可匹配的表单字段', 'warning');
      }
    });
  } catch (error) {
    if (btn) btn.disabled = false;
    if (loading) loading.style.display = 'none';
    console.error('[Popup] 填充错误:', error);
    if (typeof appLog !== 'undefined') appLog.error('popup', 'fill.fail', '填充失败', error.message);
    showToast('填充失败：' + error.message, 'error');
  }
}

// ============================================================================
// 状态更新
// ============================================================================

function updateStatus() {
  const profileNameEl = document.getElementById('currentProfile');
  const completenessEl = document.getElementById('completeness');
  const progressBarEl = document.getElementById('completenessBar');
  const lastUsedEl = document.getElementById('lastUsed');

  if (!currentProfile) {
    if (profileNameEl) profileNameEl.textContent = '未配置';
    if (completenessEl) completenessEl.textContent = '0%';
    if (progressBarEl) progressBarEl.style.width = '0%';
    if (lastUsedEl) lastUsedEl.textContent = '从未';
    updateProfilePreview(null);
    return;
  }

  // 当前资料名称
  if (profileNameEl) {
    profileNameEl.textContent = currentProfile.name || '默认资料';
    profileNameEl.title = currentProfile.name || '';
  }

  // 计算完整度
  const completeness = calculateCompleteness(currentProfile);
  if (completenessEl) completenessEl.textContent = `${completeness}%`;
  if (progressBarEl) progressBarEl.style.width = `${completeness}%`;

  // 上次使用时间
  const lastUsed = currentProfile.lastUsedAt || currentProfile.updatedAt;
  if (lastUsedEl) lastUsedEl.textContent = formatTime(lastUsed);

  // 更新资料速览
  updateProfilePreview(currentProfile);

  // 更新已记录投递数
  chrome.runtime.sendMessage({ action: 'getSubmissions' }, (response) => {
    const list = response && response.success && Array.isArray(response.submissions) ? response.submissions : [];
    const totalEl = document.getElementById('popupSubTotal');
    if (totalEl) totalEl.textContent = list.length;
  });
}

// 高级质感卡片预览
function updateProfilePreview(profile) {
  const email = profile?.basicInfo?.email || '未填邮箱';
  const phone = profile?.basicInfo?.phone || '未填手机';
  const school = profile?.education?.[0]?.school || '未填学校';
  const company = profile?.workExperience?.[0]?.company || '未填工作/实习';

  const previewHtml = `
    <div class="profile-preview glass">
      <div class="preview-grid">
        <div class="preview-chip" title="邮箱: ${email}">
          <div class="chip-icon-box icon-mail">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
              <polyline points="22,6 12,13 2,6"></polyline>
            </svg>
          </div>
          <span class="chip-text">${email}</span>
        </div>

        <div class="preview-chip" title="手机: ${phone}">
          <div class="chip-icon-box icon-phone">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
              <line x1="12" y1="18" x2="12.01" y2="18"></line>
            </svg>
          </div>
          <span class="chip-text">${phone}</span>
        </div>

        <div class="preview-chip" title="毕业院校: ${school}">
          <div class="chip-icon-box icon-school">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
              <path d="M6 12v5c3 3 9 3 12 0v-5"></path>
            </svg>
          </div>
          <span class="chip-text">${school}</span>
        </div>

        <div class="preview-chip" title="工作/实习: ${company}">
          <div class="chip-icon-box icon-work">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
          </div>
          <span class="chip-text">${company}</span>
        </div>
      </div>
    </div>
  `;

  const statusInfo = document.querySelector('.status-info');
  const existingPreview = document.querySelector('.profile-preview');
  if (existingPreview) {
    existingPreview.remove();
  }
  if (statusInfo) {
    statusInfo.insertAdjacentHTML('afterend', previewHtml);
  }
}

function calculateCompleteness(profile) {
  if (!profile) return 0;
  let total = 0;
  let filled = 0;

  // 基础信息 (30%)
  const basicFields = ['fullName', 'phone', 'email', 'gender', 'birthDate', 'politicalStatus', 'hometown'];
  basicFields.forEach(field => {
    total++;
    if (profile.basicInfo && profile.basicInfo[field]) filled++;
  });

  // 求职意向与语言能力 (15%)
  total += 2;
  if (profile.jobIntention?.expectedPosition || profile.jobIntention?.expectedCity) filled++;
  if (profile.languageSkills?.cet4 || profile.languageSkills?.cet6 || profile.languageSkills?.ielts || profile.languageSkills?.toefl) filled++;

  // 教育经历 (20%)
  total += 2;
  if (Array.isArray(profile.education) && profile.education.length > 0) {
    if (profile.education[0].school) filled++;
    if (profile.education[0].major && profile.education[0].degree) filled++;
  }

  // 工作/实习经历 (15%)
  total++;
  if (Array.isArray(profile.workExperience) && profile.workExperience.length > 0 && profile.workExperience[0].company) filled++;

  // 项目经历 (10%)
  total++;
  if (Array.isArray(profile.projects) && profile.projects.length > 0 && profile.projects[0].name) filled++;

  // 技能标签 (5%)
  total++;
  if (Array.isArray(profile.skills) && profile.skills.length > 0) filled++;

  // 简历源文件 (5%)
  total++;
  if (profile.resumeFile) filled++;

  return Math.round((filled / total) * 100);
}

function formatTime(isoString) {
  if (!isoString) return '从未';

  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '从未';

  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function updateLastUsed() {
  if (!currentProfile) return;

  const nowIso = new Date().toISOString();
  currentProfile.lastUsedAt = nowIso;
  const lastUsedEl = document.getElementById('lastUsed');
  if (lastUsedEl) lastUsedEl.textContent = '刚刚';

  chrome.runtime.sendMessage({
    action: 'updateProfile',
    profileId: currentProfile.id,
    updates: { lastUsedAt: nowIso }
  });
}

// ============================================================================
// 数据导入导出
// ============================================================================

function exportData() {
  chrome.runtime.sendMessage({ action: 'exportData' }, (response) => {
    if (response && response.success) {
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `秋招助手备份_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('数据导出成功', 'success');
    } else {
      showToast('导出失败，请重试', 'error');
    }
  });
}

function importData(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const data = event.target.result;
      chrome.runtime.sendMessage({ action: 'importData', data }, async (response) => {
        if (response && response.success) {
          await loadProfiles();
          updateStatus();
          showToast('数据导入成功', 'success');
        } else {
          showToast('导入失败：数据格式不匹配', 'error');
        }
      });
    } catch (e) {
      showToast('导入失败：文件解析异常', 'error');
    }
  };
  reader.readAsText(file);
}

// ============================================================================
// UI 辅助函数 - 灵动岛风格 Toast
// ============================================================================

function showToast(message, type = 'info') {
  const oldToast = document.querySelector('.toast');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
  } else if (type === 'warning') {
    iconSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  }

  toast.innerHTML = `${iconSvg}<span>${message}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-10px) scale(0.92)';
    setTimeout(() => toast.remove(), 260);
  }, 2200);
}

// ============================================================================
// Apple HIG 风格模态输入框 (替代原生 prompt)
// ============================================================================

function showApplePrompt({ title = '输入信息', subtitle = '', defaultValue = '', placeholder = '', confirmText = '确定', cancelText = '取消' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'apple-modal-overlay';
    overlay.innerHTML = `
      <div class="apple-modal-card">
        <div class="apple-modal-icon">📇</div>
        <div class="apple-modal-header">
          <h3 class="apple-modal-title">${escapeHtml(title)}</h3>
          ${subtitle ? `<p class="apple-modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <div class="apple-modal-body">
          <input type="text" class="apple-modal-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}">
        </div>
        <div class="apple-modal-actions">
          <button type="button" class="btn-modal-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn-modal-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('.apple-modal-input');
    const cancelBtn = overlay.querySelector('.btn-modal-cancel');
    const confirmBtn = overlay.querySelector('.btn-modal-confirm');

    input.focus();
    input.select();

    function cleanup(val) {
      overlay.remove();
      resolve(val);
    }

    cancelBtn.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(null);
    });

    function submit() {
      cleanup(input.value.trim());
    }

    confirmBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(null);
      }
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
