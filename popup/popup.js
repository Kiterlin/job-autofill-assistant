// ============================================================================
// Popup 交互逻辑 - 极简版，参考 ApplyEase
// ============================================================================

let currentProfile = null;
let allProfiles = [];
let activeProfileId = null;

// ============================================================================
// 初始化
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Popup] 初始化');
  await loadProfiles();
  bindEvents();
  updateStatus();
});

// ============================================================================
// 数据加载
// ============================================================================

async function loadProfiles() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getAllProfiles' }, (response) => {
      if (response && response.success) {
        allProfiles = response.profiles;
        activeProfileId = response.activeProfileId;

        // 填充下拉框
        const select = document.getElementById('profileSelect');
        select.innerHTML = '';

        if (allProfiles.length === 0) {
          select.innerHTML = '<option value="">未配置资料</option>';
          resolve();
          return;
        }

        allProfiles.forEach(profile => {
          const option = document.createElement('option');
          option.value = profile.id;
          option.textContent = profile.name;
          if (profile.id === activeProfileId) {
            option.selected = true;
          }
          select.appendChild(option);
        });

        // 加载当前激活的资料
        currentProfile = allProfiles.find(p => p.id === activeProfileId);
      }
      resolve();
    });
  });
}

// ============================================================================
// 事件绑定
// ============================================================================

function bindEvents() {
  // 资料切换
  document.getElementById('profileSelect').addEventListener('change', async (e) => {
    const profileId = e.target.value;
    if (!profileId) return;

    await switchProfile(profileId);
    updateStatus();
  });

  // 新增资料
  document.getElementById('addProfileBtn').addEventListener('click', () => {
    const name = prompt('请输入新资料名称:', '新资料');
    if (!name) return;

    chrome.runtime.sendMessage({ action: 'addProfile', name }, async (response) => {
      if (response.success) {
        await loadProfiles();
        updateStatus();
        showToast('新资料已创建', 'success');
      }
    });
  });

  // 填充按钮
  document.getElementById('fillBtn').addEventListener('click', fillCurrentPage);

  // 配置按钮 - 打开配置页面
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // 导出数据
  document.getElementById('exportLink').addEventListener('click', (e) => {
    e.preventDefault();
    exportData();
  });

  // 导入数据
  document.getElementById('importLink').addEventListener('click', (e) => {
    e.preventDefault();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = importData;
    input.click();
  });

  // 帮助
  document.getElementById('helpLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('README.md') });
  });
}

// ============================================================================
// 核心功能
// ============================================================================

async function switchProfile(profileId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'setActiveProfile', profileId }, (response) => {
      if (response.success) {
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
    showToast('请先配置资料', 'warning');
    return;
  }

  const btn = document.getElementById('fillBtn');
  const loading = document.getElementById('loadingState');

  btn.disabled = true;
  loading.style.display = 'flex';

  try {
    // 获取当前标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 检查是否是特殊页面（chrome://、edge://等）
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      btn.disabled = false;
      loading.style.display = 'none';
      showToast('无法在此页面使用扩展', 'error');
      return;
    }

    // 先尝试注入 content script（如果页面已加载但脚本未注入）
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['scripts/content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['styles/content.css']
      });
      // 等待脚本初始化
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (e) {
      // 可能已经注入过了，忽略错误
      console.log('[Popup] Content script 可能已存在');
    }

    // 发送消息到content script
    chrome.tabs.sendMessage(tab.id, {
      action: 'fillForm',
      profile: currentProfile
    }, (response) => {
      btn.disabled = false;
      loading.style.display = 'none';

      if (chrome.runtime.lastError) {
        console.error('[Popup] 消息发送失败:', chrome.runtime.lastError);
        showToast('填充失败，请重试', 'error');
        return;
      }

      if (response && response.success) {
        const count = response.result.filledCount;
        showToast(`已填充 ${count} 个字段`, 'success');

        // 更新上次使用时间
        updateLastUsed();
      } else {
        showToast('填充失败', 'error');
      }
    });
  } catch (error) {
    btn.disabled = false;
    loading.style.display = 'none';
    console.error('[Popup] 填充错误:', error);
    showToast('填充失败：' + error.message, 'error');
  }
}

// ============================================================================
// 状态更新
// ============================================================================

function updateStatus() {
  if (!currentProfile) {
    document.getElementById('currentProfile').textContent = '未配置';
    document.getElementById('completeness').textContent = '0%';
    document.getElementById('lastUsed').textContent = '从未';
    return;
  }

  // 当前资料名称
  document.getElementById('currentProfile').textContent = currentProfile.name;

  // 计算完整度
  const completeness = calculateCompleteness(currentProfile);
  document.getElementById('completeness').textContent = completeness + '%';

  // 上次使用时间
  const lastUsed = currentProfile.lastUsedAt || currentProfile.updatedAt;
  document.getElementById('lastUsed').textContent = formatTime(lastUsed);

  // 添加资料预览
  updateProfilePreview(currentProfile);
}

// 添加资料预览功能
function updateProfilePreview(profile) {
  const previewHtml = `
    <div class="profile-preview">
      <div class="preview-item">
        <span class="preview-label">📧</span>
        <span class="preview-value">${profile.basicInfo.email || '-'}</span>
      </div>
      <div class="preview-item">
        <span class="preview-label">📱</span>
        <span class="preview-value">${profile.basicInfo.phone || '-'}</span>
      </div>
      <div class="preview-item">
        <span class="preview-label">🎓</span>
        <span class="preview-value">${profile.education[0]?.school || '-'}</span>
      </div>
      <div class="preview-item">
        <span class="preview-label">💼</span>
        <span class="preview-value">${profile.workExperience[0]?.company || '-'}</span>
      </div>
    </div>
  `;

  const statusInfo = document.querySelector('.status-info');
  const existingPreview = document.querySelector('.profile-preview');
  if (existingPreview) {
    existingPreview.remove();
  }
  statusInfo.insertAdjacentHTML('afterend', previewHtml);
}

function calculateCompleteness(profile) {
  let total = 0;
  let filled = 0;

  // 基础信息 (30%)
  const basicFields = ['fullName', 'phone', 'email'];
  basicFields.forEach(field => {
    total++;
    if (profile.basicInfo[field]) filled++;
  });

  // 教育经历 (20%)
  total++;
  if (profile.education.length > 0 && profile.education[0].school) filled++;

  // 工作经历 (20%)
  total++;
  if (profile.workExperience.length > 0 && profile.workExperience[0].company) filled++;

  // 项目经历 (15%)
  total++;
  if (profile.projects.length > 0 && profile.projects[0].name) filled++;

  // 技能 (10%)
  total++;
  if (profile.skills.length > 0) filled++;

  // 简历文件 (5%)
  total++;
  if (profile.resumeFile) filled++;

  return Math.round((filled / total) * 100);
}

function formatTime(isoString) {
  if (!isoString) return '从未';

  const date = new Date(isoString);
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

  chrome.runtime.sendMessage({
    action: 'updateProfile',
    profileId: currentProfile.id,
    updates: { lastUsedAt: new Date().toISOString() }
  });
}

// ============================================================================
// 数据导入导出
// ============================================================================

function exportData() {
  chrome.runtime.sendMessage({ action: 'exportData' }, (response) => {
    if (response.success) {
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `秋招助手备份_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('导出成功', 'success');
    }
  });
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const data = event.target.result;
      chrome.runtime.sendMessage({ action: 'importData', data }, async (response) => {
        if (response.success) {
          await loadProfiles();
          updateStatus();
          showToast('导入成功', 'success');
        } else {
          showToast('导入失败：数据格式错误', 'error');
        }
      });
    } catch (e) {
      showToast('导入失败：文件解析错误', 'error');
    }
  };
  reader.readAsText(file);
}

// ============================================================================
// UI 辅助函数
// ============================================================================

function showToast(message, type = 'info') {
  // 移除旧提示
  const oldToast = document.querySelector('.toast');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideDown 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
