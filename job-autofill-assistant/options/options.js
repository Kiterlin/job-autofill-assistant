// ============================================================================
// Options 页面脚本 - 全量校招网申字段增强版
// ============================================================================

let currentProfile = null;
let allProfiles = [];
let activeProfileId = null;
let aiKeySaveTimer = null;
let aiUrlSaveTimer = null;
let aiModelSaveTimer = null;
let ocrSaveTimer = null;
let profileSaveTimer = null;
let profileDirty = false;
let profileEditRevision = 0;
let pendingProfileSave = Promise.resolve(true);
let editorDocumentId = null;
let savedAiSettingsFingerprint = null;
let pendingSettingsSave = Promise.resolve(true);
let modelFetchSeq = 0;
let selectedAiResumeFile = null;
// 每次解析/取消都递增；旧解析完成后发现序号变了就丢弃结果，防止过期数据写入表单
let aiParseRunSeq = 0;

function cancelOngoingAiParse() {
  resumeParser.cancelActiveParse();
  aiParseRunSeq++;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 并发并行获取设置、简历资料与投递记录，彻底消除多重 IPC 串行往返延迟
  const [settingsRes, profilesRes, submissionsRes, editorRes] = await Promise.all([
    sendMessage({ action: 'getSettings' }).catch(() => ({})),
    sendMessage({ action: 'getAllProfiles' }).catch(() => ({})),
    sendMessage({ action: 'getSubmissions' }).catch(() => ({})),
    sendMessage({ action: 'getEditorIdentity' }).catch(() => ({}))
  ]);

  editorDocumentId = editorRes.documentId;
  initBirthDatePicker();

  // 2. 极速应用主题
  applyThemeFromSettings(settingsRes);

  // 3. 填充资料数据
  if (profilesRes && profilesRes.success) {
    allProfiles = profilesRes.profiles || [];
    activeProfileId = profilesRes.activeProfileId;
    currentProfile = allProfiles.find((profile) => profile.id === activeProfileId) || allProfiles[0] || null;

    const select = document.getElementById('profileSelect');
    if (select) {
      select.innerHTML = '';
      allProfiles.forEach((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        if (profile.id === activeProfileId) option.selected = true;
        select.appendChild(option);
      });
    }

    if (currentProfile) {
      loadProfileToForm(currentProfile);
    }
    renderNavCustomDropdown();
  }

  // 4. 应用 AI 与 OCR 配置
  applyAiSettings(settingsRes);
  savedAiSettingsFingerprint = JSON.stringify(collectAiSettingsFromDom());

  // 5. 应用投递历史数据
  allSubmissions = submissionsRes && submissionsRes.success && Array.isArray(submissionsRes.submissions) ? submissionsRes.submissions : [];
  updateSubmissionStats();

  // 6. 初始化出生日期选择器与所有 Apple Select 控件 (单次统一转换)
  initAllAppleSelects();

  // 7. 绑定事件与导航
  bindEvents();
  bindSubmissionEvents();
  initTabNav();
  bindAppLogging();

});

function applyThemeFromSettings(response) {
  try {
    const saved = response && response.success ? response.settings?.uiTheme : '';
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = saved || (prefersLight ? 'light' : 'dark');
    const mode = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem('capybara-ui-theme', mode); } catch (e) {}
  } catch (e) {
    console.log('[Options] 主题初始化异常，使用默认主题', e);
  }
}

function applyAiSettings(response) {
  if (!response || !response.success) return;
  const settings = response.settings || {};
  document.getElementById('aiEnabled').checked = !!settings.aiEnabled;
  document.getElementById('aiProvider').value = settings.aiProvider || 'deepseek';
  document.getElementById('aiApiKey').value = settings.aiApiKey || '';
  document.getElementById('aiApiUrl').value = settings.aiApiUrl || '';
  document.getElementById('aiSettings').style.display = settings.aiEnabled ? 'block' : 'none';
  populateModelSelect(settings.aiModel ? [settings.aiModel] : [], settings.aiModel || '');
  const ocrInput = document.getElementById('ocrApiKey');
  if (ocrInput) ocrInput.value = settings.ocrApiKey || '';
  if (settings.aiApiKey && settings.aiEnabled) {
    refreshModelList({ silent: true });
  }
}

async function initTheme() {
  try {
    const response = await sendMessage({ action: 'getSettings' });
    applyThemeFromSettings(response);
  } catch (e) {
    console.log('[Options] 主题初始化异常', e);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('capybara-ui-theme', next); } catch (e) {}
  sendMessage({ action: 'updateSettings', settings: { uiTheme: next } }).catch(() => {});
}

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || {});
    });
  });
}

function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

function attr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function emptyEducation() {
  return {
    id: generateId(),
    school: '',
    college: '',
    major: '',
    degree: '',
    degreeType: '',
    schoolType: '',
    startDate: '',
    endDate: '',
    gpa: '',
    rank: '',
    courses: '',
    description: ''
  };
}

function emptyWork() {
  return {
    id: generateId(),
    company: '',
    department: '',
    position: '',
    workType: '',
    city: '',
    startDate: '',
    endDate: '',
    description: '',
    achievements: ''
  };
}

function emptyProject() {
  return {
    id: generateId(),
    name: '',
    role: '',
    projectType: '',
    techStack: '',
    startDate: '',
    endDate: '',
    projectUrl: '',
    description: '',
    responsibilities: '',
    achievements: ''
  };
}

function emptyAward() {
  return {
    id: generateId(),
    name: '',
    level: '',
    date: ''
  };
}

function emptyFamilyMember() {
  return {
    id: generateId(),
    name: '',
    relation: '',
    employer: '',
    position: '',
    phone: ''
  };
}

function emptyCertificate() {
  return {
    id: generateId(),
    name: '',
    code: '',
    issuer: '',
    date: '',
    expiryDate: ''
  };
}

function normalizeCertificates(certificates) {
  return (Array.isArray(certificates) ? certificates : []).map((item) =>
    typeof item === 'string'
      ? { ...emptyCertificate(), name: item }
      : { ...emptyCertificate(), ...(item || {}), id: item?.id || generateId() }
  );
}


function collectAiSettingsFromDom() {
  return {
    aiEnabled: document.getElementById('aiEnabled').checked,
    aiProvider: document.getElementById('aiProvider').value,
    aiApiKey: document.getElementById('aiApiKey').value.trim(),
    aiApiUrl: document.getElementById('aiApiUrl').value.trim(),
    aiModel: getSelectedModel(),
    ocrApiKey: document.getElementById('ocrApiKey')?.value.trim() || ''
  };
}

function getSelectedModel() {
  const select = document.getElementById('aiModel');
  const custom = document.getElementById('aiModelCustom');
  if (!select) return (custom && custom.value.trim()) || '';
  if (select.value === '__custom__') return (custom && custom.value.trim()) || '';
  return (select.value || '').trim() || ((custom && custom.value.trim()) || '');
}

function setModelHint(text, isError) {
  const hint = document.getElementById('aiModelHint');
  if (!hint) return;
  hint.textContent = text;
  hint.style.color = isError ? '#f87171' : 'var(--text-muted)';
}

function populateModelSelect(models, selected) {
  const select = document.getElementById('aiModel');
  const custom = document.getElementById('aiModelCustom');
  if (!select) return;

  const ids = Array.from(new Set((models || []).filter(Boolean)));
  select.innerHTML = '';

  if (!ids.length) {
    select.appendChild(new Option('未获取到模型，请手动填写', ''));
    select.appendChild(new Option('手动输入…', '__custom__'));
    select.value = selected ? '__custom__' : '';
    custom.style.display = 'block';
    if (selected) custom.value = selected;
    return;
  }

  ids.forEach((id) => select.appendChild(new Option(id, id)));
  select.appendChild(new Option('手动输入…', '__custom__'));

  if (selected && ids.includes(selected)) {
    select.value = selected;
    custom.style.display = 'none';
    custom.value = '';
  } else if (selected) {
    select.value = '__custom__';
    custom.style.display = 'block';
    custom.value = selected;
  } else {
    select.value = ids[0];
    custom.style.display = 'none';
  }

  if (select._refreshAppleSelect) {
    select._refreshAppleSelect();
  } else {
    upgradeToAppleSelect(select);
  }
}

function syncCustomModelVisibility() {
  const select = document.getElementById('aiModel');
  const custom = document.getElementById('aiModelCustom');
  if (!select || !custom) return;
  const show = select.value === '__custom__' || !select.value;
  custom.style.display = show ? 'block' : 'none';
}

function scheduleOcrSettingsSave() {
  clearTimeout(ocrSaveTimer);
  ocrSaveTimer = setTimeout(autoSaveAiSettings, 400);
}

async function refreshModelList({ silent = false } = {}) {
  const settings = collectAiSettingsFromDom();
  if (!settings.aiApiKey) {
    setModelHint('请先填写 API Key，再获取可用模型', true);
    if (!silent) showToast('请先填写 API Key', 'warning');
    return [];
  }

  const seq = ++modelFetchSeq;
  const previous = getSelectedModel();
  setModelHint('正在用 API Key 获取可用模型…');
  const btn = document.getElementById('refreshModelsBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '🔄 获取中...';
  }

  try {
    const models = await resumeParser.listModels(settings);
    if (seq !== modelFetchSeq) return models;
    populateModelSelect(models, previous);
    const chosen = getSelectedModel();
    setModelHint(`已获取 ${models.length} 个可用模型` + (chosen ? `，当前：${chosen}` : ''));
    await autoSaveAiSettings();
    if (!silent) showToast(`已获取 ${models.length} 个模型`, 'success');
    return models;
  } catch (error) {
    if (seq !== modelFetchSeq) return [];
    populateModelSelect(previous ? [previous] : [], previous);
    const select = document.getElementById('aiModel');
    if (select) {
      if (![...select.options].some((opt) => opt.value === '__custom__')) {
        select.appendChild(new Option('手动输入…', '__custom__'));
      }
      select.value = '__custom__';
    }
    syncCustomModelVisibility();
    const custom = document.getElementById('aiModelCustom');
    if (custom && previous) custom.value = previous;
    setModelHint(`无法自动列出模型：${error.message}。请手动填写模型名。`, true);
    if (!silent) showToast('未能列出模型，请手动填写', 'warning');
    return [];
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg><span>获取可用模型</span>';
    }
  }
}

function setFieldValue(el, value) {
  const text = value == null ? '' : String(value);
  if (el.tagName === 'SELECT' && text && ![...el.options].some(option => option.value === text)) {
    el.add(new Option(text, text));
  }
  el.value = text;
  el._refreshAppleSelect?.();
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  setFieldValue(el, value);
  if (id === 'birthDate') {
    syncBirthDatePickerFromValue(el.value);
  }
}

function toDateInput(value) {
  const v = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}$/.test(v)) return v;
  const matched = v.match(/^(\d{4})[./年-](\d{1,2})(?:[./月-](\d{1,2}))?/);
  if (matched) {
    const month = matched[2].padStart(2, '0');
    return `${matched[1]}-${month}${matched[3] ? '-' + matched[3].padStart(2, '0') : ''}`;
  }
  return '';
}

// ============================================================================
// 出生日期极速年月日选择器 (Apple HIG 极速级联选择，告别繁琐翻页)
// ============================================================================

function initBirthDatePicker() {
  const yearSelect = document.getElementById('birthYear');
  const monthSelect = document.getElementById('birthMonth');
  const daySelect = document.getElementById('birthDay');
  const hiddenDate = document.getElementById('birthDate');
  if (!yearSelect || !monthSelect || !daySelect || !hiddenDate) return;

  // 日期选项先初始化，再回填资料，避免清空已保存的出生日期。
  yearSelect.innerHTML = '<option value="">年份</option>';
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 1900; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = `${y}年`;
    yearSelect.appendChild(opt);
  }

  // 填充月份 (01 ~ 12)
  monthSelect.innerHTML = '<option value="">月份</option>';
  for (let m = 1; m <= 12; m++) {
    const val = String(m).padStart(2, '0');
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = `${val}月`;
    monthSelect.appendChild(opt);
  }

  function updateDaysOptions(selectedDay = '') {
    const y = parseInt(yearSelect.value, 10);
    const m = parseInt(monthSelect.value, 10);
    let maxDays = 31;
    if (m === 2) {
      if (y) {
        maxDays = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28;
      } else {
        maxDays = 29;
      }
    } else if ([4, 6, 9, 11].includes(m)) {
      maxDays = 30;
    }

    const prevVal = selectedDay || daySelect.value;
    daySelect.innerHTML = '<option value="">日（可不填）</option>';
    for (let d = 1; d <= maxDays; d++) {
      const val = String(d).padStart(2, '0');
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = `${val}日`;
      daySelect.appendChild(opt);
    }

    if (prevVal && parseInt(prevVal, 10) <= maxDays) {
      daySelect.value = prevVal.padStart(2, '0');
    }

    if (daySelect._refreshAppleSelect) {
      daySelect._refreshAppleSelect();
    } else {
      upgradeToAppleSelect(daySelect);
    }
  }

  updateDaysOptions();

  function syncToHidden() {
    const y = yearSelect.value;
    const m = monthSelect.value;
    const d = daySelect.value;
    if (y && m && d) {
      hiddenDate.value = `${y}-${m}-${d}`;
    } else if (y && m) {
      hiddenDate.value = `${y}-${m}`;
    } else if (y) {
      hiddenDate.value = ''; // 尚未提供月份时，不推断月日。
    } else {
      hiddenDate.value = '';
    }
    hiddenDate.dispatchEvent(new Event('input', { bubbles: true }));
    hiddenDate.dispatchEvent(new Event('change', { bubbles: true }));
  }

  yearSelect.addEventListener('change', () => {
    updateDaysOptions();
    syncToHidden();
  });

  monthSelect.addEventListener('change', () => {
    updateDaysOptions();
    syncToHidden();
  });

  daySelect.addEventListener('change', () => {
    syncToHidden();
  });

  upgradeToAppleSelect(yearSelect);
  upgradeToAppleSelect(monthSelect);
  upgradeToAppleSelect(daySelect);
}

function syncBirthDatePickerFromValue(val) {
  const yearSelect = document.getElementById('birthYear');
  const monthSelect = document.getElementById('birthMonth');
  const daySelect = document.getElementById('birthDay');
  if (!yearSelect || !monthSelect || !daySelect) return;

  const str = String(val || '').trim();
  if (!str) {
    yearSelect.value = '';
    monthSelect.value = '';
    daySelect.value = '';
    yearSelect._refreshAppleSelect?.();
    monthSelect._refreshAppleSelect?.();
    daySelect._refreshAppleSelect?.();
    return;
  }

  yearSelect.value = '';
  monthSelect.value = '';
  daySelect.value = '';
  const parts = str.split(/[-/.\s年日月]/).filter(Boolean);
  if (/^\d{4}$/.test(parts[0]) && ![...yearSelect.options].some(option => option.value === parts[0])) {
    yearSelect.add(new Option(`${parts[0]}年`, parts[0]));
  }
  if (parts.length >= 1) {
    const y = parts[0];
    if (yearSelect.querySelector(`option[value="${y}"]`)) {
      yearSelect.value = y;
    }
  }
  if (parts.length >= 2) {
    const m = parts[1].padStart(2, '0');
    if (monthSelect.querySelector(`option[value="${m}"]`)) {
      monthSelect.value = m;
    }
  }

  const y = parseInt(yearSelect.value, 10);
  const m = parseInt(monthSelect.value, 10);
  let maxDays = 31;
  if (m === 2) {
    if (y) {
      maxDays = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28;
    } else {
      maxDays = 29;
    }
  } else if ([4, 6, 9, 11].includes(m)) {
    maxDays = 30;
  }

  daySelect.innerHTML = '<option value="">日（可不填）</option>';
  for (let d = 1; d <= maxDays; d++) {
    const dVal = String(d).padStart(2, '0');
    const opt = document.createElement('option');
    opt.value = dVal;
    opt.textContent = `${dVal}日`;
    daySelect.appendChild(opt);
  }

  if (parts.length >= 3) {
    const d = parts[2].padStart(2, '0');
    if (parseInt(d, 10) <= maxDays) {
      daySelect.value = d;
    }
  }

  yearSelect._refreshAppleSelect?.();
  monthSelect._refreshAppleSelect?.();
  daySelect._refreshAppleSelect?.();
}

async function loadProfiles() {
  const response = await sendMessage({ action: 'getAllProfiles' });
  if (!response.success) return;

  allProfiles = response.profiles || [];
  activeProfileId = response.activeProfileId;

  const select = document.getElementById('profileSelect');
  select.innerHTML = '';
  allProfiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    if (profile.id === activeProfileId) option.selected = true;
    select.appendChild(option);
  });

  currentProfile = allProfiles.find((profile) => profile.id === activeProfileId) || null;
  if (currentProfile) {
    loadProfileToForm(currentProfile);
  }
  renderNavCustomDropdown();
  await loadAISettings();
}

function renderNavCustomDropdown() {
  const nameLabel = document.getElementById('navSelectedProfileName');
  const menu = document.getElementById('navProfileDropdownMenu');
  if (!nameLabel || !menu) return;

  if (!currentProfile) {
    nameLabel.textContent = '暂无简历资料';
    menu.innerHTML = '<div class="nav-dropdown-item" style="color:var(--text-muted);">暂无资料</div>';
    return;
  }

  nameLabel.textContent = currentProfile.name || '默认资料';
  menu.innerHTML = '';

  allProfiles.forEach((profile) => {
    const isAct = profile.id === currentProfile.id;
    const item = document.createElement('div');
    item.className = 'nav-dropdown-item' + (isAct ? ' active' : '');
    item.innerHTML = `
      <span>${html(profile.name)}</span>
      ${isAct ? '<span class="check-icon">✓</span>' : ''}
    `;
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeNavCustomDropdown();
      if (profile.id !== currentProfile.id) {
        await switchProfile(profile.id);
      }
    });
    menu.appendChild(item);
  });
}

function toggleNavCustomDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('navProfileDropdown');
  if (dropdown) {
    dropdown.classList.toggle('is-open');
  }
}

function closeNavCustomDropdown() {
  const dropdown = document.getElementById('navProfileDropdown');
  if (dropdown) {
    dropdown.classList.remove('is-open');
  }
}

// ============================================================================
// Apple HIG 通用自定义下拉组件 (彻底替代原生 select)
// ============================================================================

function upgradeToAppleSelect(select) {
  if (!select || select.dataset.appleSelectInitialized) {
    if (select && select._refreshAppleSelect) {
      select._refreshAppleSelect();
    }
    return;
  }
  if (select.id === 'profileSelect') return; // 顶栏资料切换由专门 popover 处理
  select.dataset.appleSelectInitialized = 'true';

  // 隐藏原始 select 保留底层事件
  select.style.display = 'none';
  const oldArrow = select.parentNode?.querySelector('.field-arrow');
  if (oldArrow) oldArrow.style.display = 'none';

  const box = document.createElement('div');
  box.className = 'apple-custom-select-box';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'apple-custom-select-trigger';
  const fieldLabel = [...select.labels].map(label => label.textContent.trim()).join(' ');
  if (fieldLabel) trigger.setAttribute('aria-label', fieldLabel);

  const label = document.createElement('span');
  label.className = 'apple-custom-select-label';

  const arrow = document.createElement('span');
  arrow.className = 'apple-custom-select-arrow';
  arrow.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

  trigger.appendChild(label);
  trigger.appendChild(arrow);

  const popover = document.createElement('div');
  popover.className = 'apple-custom-select-popover';

  function renderOptions() {
    popover.innerHTML = '';
    const selectedOption = select.options[select.selectedIndex] || select.options[0];
    label.textContent = selectedOption ? selectedOption.text : (select.placeholder || '请选择');

    Array.from(select.options).forEach((opt, idx) => {
      const optionItem = document.createElement('div');
      const isSelected = opt.selected || idx === select.selectedIndex;
      optionItem.className = 'apple-custom-select-option' + (isSelected ? ' selected' : '');
      optionItem.innerHTML = `
        <span>${html(opt.text)}</span>
        ${isSelected ? '<span class="option-check">✓</span>' : ''}
      `;

      optionItem.addEventListener('click', (e) => {
        e.stopPropagation();
        box.classList.remove('is-open');
        if (select.value !== opt.value) {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          renderOptions();
        }
      });
      popover.appendChild(optionItem);
    });
  }

  renderOptions();

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = box.classList.contains('is-open');
    document.querySelectorAll('.apple-custom-select-box.is-open').forEach((b) => {
      if (b !== box) b.classList.remove('is-open');
    });
    if (!isOpen) {
      renderOptions();
      box.classList.add('is-open');
      const selItem = popover.querySelector('.apple-custom-select-option.selected');
      if (selItem) {
        selItem.scrollIntoView({ block: 'nearest' });
      }
    } else {
      box.classList.remove('is-open');
    }
  });

  box.appendChild(trigger);
  box.appendChild(popover);

  select.parentNode.insertBefore(box, select.nextSibling);

  // 监听原生 select 变化以保持同步
  select.addEventListener('change', () => {
    renderOptions();
  });

  // 保存刷新钩子
  select._refreshAppleSelect = renderOptions;
}

function initAllAppleSelects(root = document) {
  root.querySelectorAll('select:not([data-apple-custom="false"])').forEach(upgradeToAppleSelect);
}

// ============================================================================
// Apple HIG 原生级模态输入与确认弹窗 (替代丑陋的 window.prompt / confirm)
// ============================================================================

function showApplePrompt({ title = '输入信息', subtitle = '', defaultValue = '', placeholder = '', confirmText = '确定', cancelText = '取消' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'apple-modal-overlay';
    overlay.innerHTML = `
      <div class="apple-modal-card">
        <div class="apple-modal-icon">📇</div>
        <div class="apple-modal-header">
          <h3 class="apple-modal-title">${html(title)}</h3>
          ${subtitle ? `<p class="apple-modal-subtitle">${html(subtitle)}</p>` : ''}
        </div>
        <div class="apple-modal-body">
          <input type="text" class="apple-modal-input" placeholder="${attr(placeholder)}" value="${attr(defaultValue)}">
        </div>
        <div class="apple-modal-actions">
          <button type="button" class="btn-modal-cancel">${html(cancelText)}</button>
          <button type="button" class="btn-modal-confirm">${html(confirmText)}</button>
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

function showAppleConfirm({ title = '确认操作', subtitle = '', confirmText = '确定删除', cancelText = '取消', isDanger = true }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'apple-modal-overlay';
    overlay.innerHTML = `
      <div class="apple-modal-card">
        <div class="apple-modal-icon ${isDanger ? 'danger' : ''}">${isDanger ? '⚠️' : '❓'}</div>
        <div class="apple-modal-header">
          <h3 class="apple-modal-title">${html(title)}</h3>
          ${subtitle ? `<p class="apple-modal-subtitle">${html(subtitle)}</p>` : ''}
        </div>
        <div class="apple-modal-actions">
          <button type="button" class="btn-modal-cancel">${html(cancelText)}</button>
          <button type="button" class="btn-modal-confirm ${isDanger ? 'danger' : ''}">${html(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector('.btn-modal-cancel');
    const confirmBtn = overlay.querySelector('.btn-modal-confirm');

    function cleanup(val) {
      overlay.remove();
      resolve(val);
    }

    cancelBtn.addEventListener('click', () => cleanup(false));
    confirmBtn.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    function escHandler(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        cleanup(false);
      }
    }
    document.addEventListener('keydown', escHandler);
  });
}

async function loadAISettings() {
  const response = await sendMessage({ action: 'getSettings' });
  if (!response.success) return;
  const settings = response.settings || {};
  document.getElementById('aiEnabled').checked = !!settings.aiEnabled;
  document.getElementById('aiProvider').value = settings.aiProvider || 'deepseek';
  document.getElementById('aiApiKey').value = settings.aiApiKey || '';
  document.getElementById('aiApiUrl').value = settings.aiApiUrl || '';
  document.getElementById('aiSettings').style.display = settings.aiEnabled ? 'block' : 'none';
  populateModelSelect(settings.aiModel ? [settings.aiModel] : [], settings.aiModel || '');
  document.getElementById('ocrApiKey').value = settings.ocrApiKey || '';
  if (settings.aiApiKey && settings.aiEnabled) {
    refreshModelList({ silent: true });
  }
  savedAiSettingsFingerprint = JSON.stringify(collectAiSettingsFromDom());
}

function loadProfileToForm(profile) {
  const info = profile.basicInfo || {};
  setInputValue('fullName', info.fullName);
  setInputValue('firstName', info.firstName);
  setInputValue('lastName', info.lastName);
  setInputValue('phone', info.phone);
  setInputValue('email', info.email);
  setInputValue('gender', info.gender);
  setInputValue('birthDate', toDateInput(info.birthDate) || info.birthDate || '');
  setInputValue('idCard', info.idCard);
  setInputValue('politicalStatus', info.politicalStatus);
  setInputValue('ethnicity', info.ethnicity);
  setInputValue('hometown', info.hometown);
  setInputValue('graduationDate', info.graduationDate);
  setInputValue('maritalStatus', info.maritalStatus);
  setInputValue('currentCity', info.currentCity);
  setInputValue('emergencyContact', info.emergencyContact);
  setInputValue('emergencyRelation', info.emergencyRelation);
  setInputValue('emergencyPhone', info.emergencyPhone);
  setInputValue('city', info.city);
  setInputValue('state', info.state);
  setInputValue('country', info.country);
  setInputValue('zipCode', info.zipCode);
  setInputValue('street', info.street);
  setInputValue('linkedin', info.linkedin);
  setInputValue('github', info.github);
  setInputValue('website', info.website);
  setInputValue('twitter', info.twitter);

  // 求职意向
  const job = profile.jobIntention || {};
  setInputValue('expectedCity', job.expectedCity);
  setInputValue('expectedPosition', job.expectedPosition);
  setInputValue('expectedSalary', job.expectedSalary);
  setInputValue('availableDate', job.availableDate);
  setInputValue('referralCode', job.referralCode);
  setInputValue('recruitSource', job.recruitSource);
  setInputValue('willingToTravel', job.willingToTravel);

  // 语言能力
  const lang = profile.languageSkills || {};
  setInputValue('cet4', lang.cet4);
  setInputValue('cet6', lang.cet6);
  setInputValue('ielts', lang.ielts);
  setInputValue('toefl', lang.toefl);
  setInputValue('otherLanguages', lang.otherLanguages);

  // 动态列表
  renderEducationList(profile.education || []);
  renderWorkList(profile.workExperience || []);
  renderProjectList(profile.projects || []);
  renderAwardsList(profile.awards || []);
  renderFamilyList(profile.familyMembers || []);
  const certificates = normalizeCertificates(profile.certificates);
  renderCertificatesList(certificates);
  renderSkillsList(profile.skills || []);

  document.getElementById('introduction').value = profile.introTemplates?.default || '';
  updateResumeAttachmentUI(profile.attachments?.resume?.name || profile.resumeFileName || '', profile.attachments?.resume?.size || 0);

  const greetingEl = document.getElementById('hrGreetingText');
  if (greetingEl) {
    greetingEl.value = profile.hrGreeting || '';
    updateGreetingCharCount(profile.hrGreeting || '');
  }

  renderExtendedProfile(profile);
  // 刷新所有 Apple 自定义下拉选框
  initAllAppleSelects();
}

function renderEducationList(educationList) {
  const container = document.getElementById('educationList');
  container.innerHTML = '';

  educationList.forEach((edu, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4>教育经历 ${index + 1}</h4>
        <button type="button" class="btn-delete" data-id="${attr(edu.id)}" data-type="education">删除经历</button>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>学校名称 <span class="required">*</span></label>
          <input type="text" class="edu-school" data-id="${attr(edu.id)}" value="${attr(edu.school)}" placeholder="例如: 北京大学">
        </div>
        <div class="form-group">
          <label>所属学院 / 院系</label>
          <input type="text" class="edu-college" value="${attr(edu.college)}" placeholder="例如: 计算机学院">
        </div>
        <div class="form-group">
          <label>专业全称 <span class="required">*</span></label>
          <input type="text" class="edu-major" value="${attr(edu.major)}" placeholder="例如: 计算机科学与技术">
        </div>
      </div>
      <div class="form-row form-row-4">
        <div class="form-group">
          <label>学历层次</label>
          <div class="select-box">
            <select class="edu-degree">
              <option value="">请选择</option>
              <option value="高中" ${edu.degree === '高中' ? 'selected' : ''}>高中</option>
              <option value="大专" ${edu.degree === '大专' ? 'selected' : ''}>大专</option>
              <option value="本科" ${edu.degree === '本科' ? 'selected' : ''}>本科</option>
              <option value="硕士" ${edu.degree === '硕士' ? 'selected' : ''}>硕士</option>
              <option value="博士" ${edu.degree === '博士' ? 'selected' : ''}>博士</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>培养方式</label>
          <div class="select-box">
            <select class="edu-degree-type">
              <option value="">请选择</option>
              <option value="普通全日制统招" ${edu.degreeType === '普通全日制统招' ? 'selected' : ''}>普通全日制统招</option>
              <option value="非全日制" ${edu.degreeType === '非全日制' ? 'selected' : ''}>非全日制</option>
              <option value="海外留学生" ${edu.degreeType === '海外留学生' ? 'selected' : ''}>海外留学生</option>
              <option value="定向委培" ${edu.degreeType === '定向委培' ? 'selected' : ''}>定向委培</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>院校层次</label>
          <div class="select-box">
            <select class="edu-school-type">
              <option value="">请选择</option>
              <option value="985" ${edu.schoolType === '985' ? 'selected' : ''}>985</option>
              <option value="211" ${edu.schoolType === '211' ? 'selected' : ''}>211</option>
              <option value="双一流" ${edu.schoolType === '双一流' ? 'selected' : ''}>双一流</option>
              <option value="普通本科" ${edu.schoolType === '普通本科' ? 'selected' : ''}>普通本科</option>
              <option value="专科" ${edu.schoolType === '专科' ? 'selected' : ''}>专科</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>GPA / 平均分</label>
          <input type="text" class="edu-gpa" value="${attr(edu.gpa)}" placeholder="例如: 3.8/4.0 或 89/100">
        </div>
        <div class="form-group">
          <label>专业 / 成绩排名</label>
          <input type="text" class="edu-rank" value="${attr(edu.rank)}" placeholder="例如: 前5% 或 3/120">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>入学时间</label>
          <input type="text" class="edu-start" value="${attr(edu.startDate)}" placeholder="例如: 2022-09">
        </div>
        <div class="form-group">
          <label>毕业时间</label>
          <input type="text" class="edu-end" value="${attr(edu.endDate)}" placeholder="例如: 2026-06 或 至今">
        </div>
      </div>
      <div class="form-group">
        <label>主修核心课程</label>
        <textarea class="edu-courses" rows="2" placeholder="例如: 数据结构与算法、计算机网络、操作系统、计算机体系结构、数据库原理">${html(edu.courses)}</textarea>
      </div>
      <div class="form-group">
        <label>在校经历 / 补充说明</label>
        <textarea class="edu-description" rows="3" placeholder="在校职务、荣誉、论文及其他补充信息">${html(edu.description)}</textarea>
      </div>
    `;
    setFieldValue(card.querySelector('.edu-degree'), edu.degree);
    setFieldValue(card.querySelector('.edu-degree-type'), edu.degreeType);
    setFieldValue(card.querySelector('.edu-school-type'), edu.schoolType);
    appendExtendedFields(card, 'education', edu);
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="education"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteEducation(e.currentTarget.getAttribute('data-id')));
  });

  initAllAppleSelects(container);
}

function renderWorkList(workList) {
  const container = document.getElementById('workList');
  container.innerHTML = '';

  workList.forEach((work, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4>工作 / 实习经历 ${index + 1}</h4>
        <button type="button" class="btn-delete" data-id="${attr(work.id)}" data-type="work">删除经历</button>
      </div>
      <div class="form-row form-row-4">
        <div class="form-group">
          <label>公司 / 组织名称 <span class="required">*</span></label>
          <input type="text" class="work-company" data-id="${attr(work.id)}" value="${attr(work.company)}" placeholder="例如: 字节跳动">
        </div>
        <div class="form-group">
          <label>所属部门 / 业务线</label>
          <input type="text" class="work-department" value="${attr(work.department)}" placeholder="例如: 抖音电商研发部">
        </div>
        <div class="form-group">
          <label>职位名称 <span class="required">*</span></label>
          <input type="text" class="work-position" value="${attr(work.position)}" placeholder="例如: 前端开发实习生">
        </div>
        <div class="form-group">
          <label>工作性质</label>
          <div class="select-box">
            <select class="work-type">
              <option value="">请选择</option>
              <option value="实习" ${work.workType === '实习' ? 'selected' : ''}>实习</option>
              <option value="全职" ${work.workType === '全职' ? 'selected' : ''}>全职</option>
              <option value="兼职" ${work.workType === '兼职' ? 'selected' : ''}>兼职</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>工作城市</label>
          <input type="text" class="work-city" value="${attr(work.city)}" placeholder="例如: 北京 / 杭州">
        </div>
        <div class="form-group">
          <label>开始时间</label>
          <input type="text" class="work-start" value="${attr(work.startDate)}" placeholder="例如: 2024-06">
        </div>
        <div class="form-group">
          <label>结束时间</label>
          <input type="text" class="work-end" value="${attr(work.endDate)}" placeholder="例如: 2024-09 或 至今">
        </div>
      </div>
      <div class="form-group">
        <label>工作职责与内容 (建议采用 STAR 原则描述)</label>
        <textarea class="work-desc" rows="3" placeholder="负责核心模块的设计与开发，协同后端与产品快速迭代业务需求...">${html(work.description)}</textarea>
      </div>
      <div class="form-group">
        <label>核心量化业务成果 / 产出贡献</label>
        <textarea class="work-achievements" rows="2" placeholder="例如: 优化首屏加载耗时 35%，主导模块上线支撑日活 500 万+ 用户">${html(work.achievements)}</textarea>
      </div>
    `;
    setFieldValue(card.querySelector('.work-type'), work.workType);
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="work"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteWorkExperience(e.currentTarget.getAttribute('data-id')));
  });

  initAllAppleSelects(container);
}

function renderProjectList(projectList) {
  const container = document.getElementById('projectList');
  container.innerHTML = '';

  projectList.forEach((project, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4>项目经历 ${index + 1}</h4>
        <button type="button" class="btn-delete" data-id="${attr(project.id)}" data-type="project">删除项目</button>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>项目名称 <span class="required">*</span></label>
          <input type="text" class="proj-name" data-id="${attr(project.id)}" value="${attr(project.name)}" placeholder="例如: 高性能在线协同文档系统">
        </div>
        <div class="form-group">
          <label>担任角色</label>
          <input type="text" class="proj-role" value="${attr(project.role)}" placeholder="例如: 核心前端负责人 / 独立开发者">
        </div>
        <div class="form-group">
          <label>项目类型</label>
          <div class="select-box">
            <select class="proj-type">
              <option value="">请选择</option>
              <option value="商业项目" ${project.projectType === '商业项目' ? 'selected' : ''}>商业项目</option>
              <option value="科研课题" ${project.projectType === '科研课题' ? 'selected' : ''}>科研课题</option>
              <option value="竞赛获奖" ${project.projectType === '竞赛获奖' ? 'selected' : ''}>竞赛获奖</option>
              <option value="开源项目" ${project.projectType === '开源项目' ? 'selected' : ''}>开源项目</option>
              <option value="课程设计" ${project.projectType === '课程设计' ? 'selected' : ''}>课程设计</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>技术栈 / 关键技术</label>
          <input type="text" class="proj-tech" value="${attr(project.techStack || (Array.isArray(project.technologies) ? project.technologies.join(', ') : ''))}" placeholder="例如: React, TypeScript, WebRTC, Node.js">
        </div>
        <div class="form-group">
          <label>开始时间</label>
          <input type="text" class="proj-start" value="${attr(project.startDate)}" placeholder="例如: 2023-10">
        </div>
        <div class="form-group">
          <label>结束时间</label>
          <input type="text" class="proj-end" value="${attr(project.endDate)}" placeholder="例如: 2024-03 或 至今">
        </div>
      </div>
      <div class="form-group">
        <label>项目在线链接 / Demo / GitHub</label>
        <input type="url" class="proj-url" value="${attr(project.projectUrl)}" placeholder="https://github.com/username/project">
      </div>
      <div class="form-group">
        <label>项目背景与功能描述</label>
        <textarea class="proj-desc" rows="2" placeholder="简要描述项目的业务场景与要解决的核心痛点...">${html(project.description)}</textarea>
      </div>
      <div class="form-group">
        <label>个人职责与技术难点攻坚</label>
        <textarea class="proj-resp" rows="2" placeholder="负责 OT 协同算法的设计与实现，解决高并发网络抖动冲突问题...">${html(project.responsibilities)}</textarea>
      </div>
      <div class="form-group">
        <label>项目产出与成果量化</label>
        <textarea class="proj-achieve" rows="2" placeholder="例如: 荣获全国大学生计算机设计大赛一等奖，系统上线稳定支撑 10w+ 用户访问">${html(project.achievements)}</textarea>
      </div>
    `;
    setFieldValue(card.querySelector('.proj-type'), project.projectType);
    appendExtendedFields(card, 'projects', project);
    const projectLink = card.querySelector('.proj-url').closest('.form-group');
    const projectRow = document.createElement('div');
    projectRow.className = 'form-row project-link-row';
    projectLink.before(projectRow);
    projectRow.append(projectLink, card.querySelector('[data-field="projectLevel"]'));
    card.querySelector('.extended-fields').remove();
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="project"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteProject(e.currentTarget.getAttribute('data-id')));
  });

  initAllAppleSelects(container);
}

function renderAwardsList(awardsList) {
  const container = document.getElementById('awardsList');
  if (!container) return;
  container.innerHTML = '';

  awardsList.forEach((award, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4>荣誉奖项 ${index + 1}</h4>
        <button type="button" class="btn-delete" data-id="${attr(award.id)}" data-type="award">删除奖项</button>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>奖项 / 竞赛全称 <span class="required">*</span></label>
          <input type="text" class="award-name" data-id="${attr(award.id)}" value="${attr(award.name)}" placeholder="例如: 国家奖学金 / ACM-ICPC 区域赛金奖">
        </div>
        <div class="form-group">
          <label>获奖级别</label>
          <div class="select-box">
            <select class="award-level">
              <option value="">请选择</option>
              <option value="国家级" ${award.level === '国家级' ? 'selected' : ''}>国家级</option>
              <option value="省部级" ${award.level === '省部级' ? 'selected' : ''}>省部级</option>
              <option value="校级" ${award.level === '校级' ? 'selected' : ''}>校级</option>
              <option value="院系级" ${award.level === '院系级' ? 'selected' : ''}>院系级</option>
              <option value="企业级/行业级" ${award.level === '企业级/行业级' ? 'selected' : ''}>企业级/行业级</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>获奖时间</label>
          <input type="text" class="award-date" value="${attr(award.date)}" placeholder="例如: 2024-11">
        </div>
      </div>
    `;
    setFieldValue(card.querySelector('.award-level'), award.level);
    appendExtendedFields(card, 'awards', award);
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="award"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteAward(e.currentTarget.getAttribute('data-id')));
  });

  initAllAppleSelects(container);
}

function renderFamilyList(members) {
  const container = document.getElementById('familyList');
  if (!container) return;
  container.innerHTML = '';
  members.forEach((member, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4>家庭成员 ${index + 1}</h4>
        <button type="button" class="btn-delete" data-id="${attr(member.id)}" data-type="family">删除成员</button>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group"><label>姓名</label><input type="text" class="family-name" data-id="${attr(member.id)}" value="${attr(member.name)}"></div>
        <div class="form-group"><label>与本人关系</label><input type="text" class="family-relation" value="${attr(member.relation)}" placeholder="父亲 / 母亲 / 配偶"></div>
        <div class="form-group"><label>联系电话</label><input type="tel" class="family-phone" value="${attr(member.phone)}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>工作单位</label><input type="text" class="family-employer" value="${attr(member.employer)}"></div>
        <div class="form-group"><label>职务</label><input type="text" class="family-position" value="${attr(member.position)}"></div>
      </div>`;
    appendExtendedFields(card, 'familyMembers', member);
    const familyRow = card.querySelector('.family-employer').closest('.form-row');
    familyRow.classList.add('form-row-3');
    familyRow.append(card.querySelector('[data-field="birthDate"]'));
    card.querySelector('.extended-fields').remove();
    container.appendChild(card);
  });
  container.querySelectorAll('.btn-delete[data-type="family"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteFamilyMember(e.currentTarget.getAttribute('data-id')));
  });
}

function renderCertificatesList(certificates) {
  const container = document.getElementById('certificatesList');
  if (!container) return;
  container.innerHTML = '';
  certificates.forEach((certificate, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4>资格证书 ${index + 1}</h4>
        <button type="button" class="btn-delete" data-id="${attr(certificate.id)}" data-type="certificate">删除证书</button>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group"><label>证书名称</label><input type="text" class="certificate-name" data-id="${attr(certificate.id)}" value="${attr(certificate.name)}"></div>
        <div class="form-group"><label>证书编号</label><input type="text" class="certificate-code" value="${attr(certificate.code)}"></div>
        <div class="form-group"><label>颁发机构</label><input type="text" class="certificate-issuer" value="${attr(certificate.issuer)}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>取得日期</label><input type="text" class="certificate-date" value="${attr(certificate.date)}" placeholder="例如: 2025-06"></div>
        <div class="form-group"><label>有效期至</label><input type="text" class="certificate-expiry" value="${attr(certificate.expiryDate)}" placeholder="例如: 2030-06 / 长期"></div>
      </div>`;
    container.appendChild(card);
  });
  container.querySelectorAll('.btn-delete[data-type="certificate"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteCertificate(e.currentTarget.getAttribute('data-id')));
  });
}

function renderSkillsList(skills) {
  const container = document.getElementById('skillsList');
  container.innerHTML = '';
  (skills || []).forEach((skill) => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `${html(skill)}<span class="tag-remove" data-skill="${attr(skill)}">×</span>`;
    container.appendChild(tag);
  });
  container.querySelectorAll('.tag-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => removeSkill(e.currentTarget.getAttribute('data-skill')));
  });
}

function bindEvents() {
  document.getElementById('navProfileDropdownBtn')?.addEventListener('click', toggleNavCustomDropdown);
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('navProfileDropdown');
    if (dropdown && !dropdown.contains(e.target)) {
      closeNavCustomDropdown();
    }
    if (!e.target.closest('.apple-custom-select-box')) {
      document.querySelectorAll('.apple-custom-select-box.is-open').forEach((b) => b.classList.remove('is-open'));
    }
    if (!e.target.closest('.apple-status-dropdown-box')) {
      document.querySelectorAll('.apple-status-dropdown-box.is-open').forEach((b) => b.classList.remove('is-open'));
    }
  });

  document.getElementById('profileSelect')?.addEventListener('change', async (e) => {
    await switchProfile(e.target.value);
  });
  document.getElementById('renameProfileBtn')?.addEventListener('click', renameCurrentProfile);
  document.getElementById('addProfileBtn').addEventListener('click', addNewProfile);
  document.getElementById('saveBtn').addEventListener('click', () => saveProfile());
  document.getElementById('saveBtn2').addEventListener('click', () => saveProfile());
  document.getElementById('sidebarSaveBtn')?.addEventListener('click', () => saveProfile());
  document.getElementById('deleteProfileBtn').addEventListener('click', deleteCurrentProfile);
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
  initSidebarNav();

  document.getElementById('addEducationBtn').addEventListener('click', () => addEducation());
  document.getElementById('addWorkBtn').addEventListener('click', () => addWorkExperience());
  document.getElementById('addProjectBtn').addEventListener('click', () => addProject());
  const addAwardBtn = document.getElementById('addAwardBtn');
  if (addAwardBtn) addAwardBtn.addEventListener('click', () => addAward());
  document.getElementById('addFamilyBtn')?.addEventListener('click', addFamilyMember);
  document.getElementById('addCertificateBtn')?.addEventListener('click', addCertificate);

  document.getElementById('skillInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkill();
    }
  });

  document.querySelectorAll('.btn-template').forEach((btn) => {
    btn.addEventListener('click', (e) => loadIntroductionTemplate(e.target.getAttribute('data-template')));
  });

  const removeAttachmentBtn = document.getElementById('removeResumeFileBtn');
  if (removeAttachmentBtn) {
    removeAttachmentBtn.addEventListener('click', async () => {
      try { await changeAttachment('deleteAttachment', 'resume', { id: currentProfile.attachments?.resume?.id }); }
      catch (error) { showToast(error.message, 'error'); return; }
      clearSelectedAiResumeFile();
    });
  }
  document.getElementById('parseTextBtn').addEventListener('click', parseResumeText);

  // HR 打招呼语事件监听
  const greetingTextEl = document.getElementById('hrGreetingText');
  if (greetingTextEl) {
    greetingTextEl.addEventListener('input', (e) => {
      updateGreetingCharCount(e.target.value);
      debouncedSave();
    });
  }

  const copyGreetingBtn = document.getElementById('copyGreetingBtn');
  if (copyGreetingBtn) {
    copyGreetingBtn.addEventListener('click', async () => {
      const text = document.getElementById('hrGreetingText')?.value.trim();
      if (!text) {
        showToast('打招呼语为空，请先点击「AI 重新生成」或上传简历', 'warning');
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast('✅ 打招呼语已复制，可直接发送给 HR！', 'success');
      } catch (e) {
        showToast('复制失败，请手动选中文本复制', 'error');
      }
    });
  }

  const regenerateGreetingBtn = document.getElementById('regenerateGreetingBtn');
  if (regenerateGreetingBtn) {
    regenerateGreetingBtn.addEventListener('click', async () => {
      const btn = regenerateGreetingBtn;
      const resp = await sendMessage({ action: 'getSettings' });
      const settings = resp?.settings || {};
      if (!settings.aiEnabled || !settings.aiApiKey) {
        showToast('请先在上方启用 AI 并填写 API Key', 'warning');
        return;
      }
      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner-ring" style="width:12px;height:12px;border-width:2px;display:inline-block;"></div><span>生成中...</span>';
      showToast('正在提炼高转化 HR 打招呼自荐语...', 'info');

      try {
        const profileData = collectProfileUpdates();
        const rawText = document.getElementById('resumeText')?.value.trim();
        const inputData = (rawText && rawText.length > 50) ? rawText : profileData;
        const greeting = await resumeParser.generateHrGreeting(inputData, settings);

        const targetEl = document.getElementById('hrGreetingText');
        if (targetEl) {
          targetEl.value = greeting;
          updateGreetingCharCount(greeting);
        }
        if (currentProfile) {
          currentProfile.hrGreeting = greeting;
        }
        await saveProfile({ silent: true });
        showToast('✅ HR 打招呼语已重新生成并保存！', 'success');
      } catch (err) {
        console.error('[生成打招呼语失败]:', err);
        showToast(`❌ 生成失败: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    });
  }

  const aiUploadBtn = document.getElementById('aiUploadBtn');
  const aiResumeFile = document.getElementById('aiResumeFile');
  if (aiUploadBtn && aiResumeFile) {
    aiUploadBtn.addEventListener('click', () => aiResumeFile.click());
    aiResumeFile.addEventListener('change', handleAiFileImport);
  }
  const resumeText = document.getElementById('resumeText');
  if (resumeText) {
    resumeText.addEventListener('input', () => {
      if (!selectedAiResumeFile) return;
      cancelOngoingAiParse();
      selectedAiResumeFile = null;
      if (aiResumeFile) aiResumeFile.value = '';
      setAiFileStatus('已切换为粘贴文本模式，将直接解析下方文字。', 'text');
    });
  }

  document.getElementById('aiEnabled').addEventListener('change', (e) => {
    document.getElementById('aiSettings').style.display = e.target.checked ? 'block' : 'none';
    autoSaveAiSettings();
    if (e.target.checked && document.getElementById('aiApiKey').value.trim()) {
      refreshModelList({ silent: true });
    }
  });
  document.getElementById('aiProvider').addEventListener('change', async () => {
    populateModelSelect([], '');
    document.getElementById('aiModelCustom').value = '';
    setModelHint('提供商已切换，请重新获取可用模型');
    await autoSaveAiSettings();
    if (document.getElementById('aiApiKey').value.trim()) {
      refreshModelList({ silent: true });
    }
  });
  document.getElementById('aiApiKey').addEventListener('input', () => {
    clearTimeout(aiKeySaveTimer);
    aiKeySaveTimer = setTimeout(async () => {
      await autoSaveAiSettings();
      const key = document.getElementById('aiApiKey').value.trim();
      if (key.length >= 16) refreshModelList({ silent: true });
    }, 600);
  });
  document.getElementById('aiApiUrl').addEventListener('input', () => {
    clearTimeout(aiUrlSaveTimer);
    aiUrlSaveTimer = setTimeout(async () => {
      await autoSaveAiSettings();
      if (document.getElementById('aiApiKey').value.trim()) {
        refreshModelList({ silent: true });
      }
    }, 600);
  });
  document.getElementById('aiModel').addEventListener('change', async () => {
    syncCustomModelVisibility();
    await autoSaveAiSettings();
  });
  document.getElementById('aiModelCustom').addEventListener('input', () => {
    clearTimeout(aiModelSaveTimer);
    aiModelSaveTimer = setTimeout(autoSaveAiSettings, 400);
  });
  document.getElementById('refreshModelsBtn').addEventListener('click', () => refreshModelList());
  document.getElementById('testAiBtn').addEventListener('click', testAiConnection);
  document.getElementById('testOcrBtn')?.addEventListener('click', testOcrConnection);

  document.getElementById('ocrApiKey').addEventListener('input', scheduleOcrSettingsSave);
  for (const eventName of ['input', 'change']) {
    document.getElementById('view-profile').addEventListener(eventName, event => {
      const input = event.target;
      if (!input.matches('input,select,textarea') || input.type === 'file' || input.id === 'skillInput' || input.closest('#section-ai,#section-parser')) return;
      debouncedSave();
    });
  }
  window.addEventListener('blur', () => { if (profileDirty) flushProfileSave(); });
}

async function switchProfile(profileId) {
  if (!await flushProfileSave()) return;
  const response = await sendMessage({ action: 'setActiveProfile', profileId });
  if (response.success) {
    clearSelectedAiResumeFile();
    await loadProfiles();
    showToast('已切换资料', 'success');
  }
}

async function addNewProfile() {
  const name = await showApplePrompt({
    title: '新建简历资料档案',
    subtitle: '为新的求职方向创建独立资料卡（如：前端开发 / 算法岗 / 英文专版）',
    defaultValue: `资料 ${allProfiles.length + 1}`,
    placeholder: '请输入新资料名称',
    confirmText: '创建资料'
  });
  if (!name || !name.trim()) return;
  if (!await flushProfileSave()) return;
  const response = await sendMessage({ action: 'addProfile', name: name.trim() });
  if (response.success) {
    clearSelectedAiResumeFile();
    await loadProfiles();
    showToast('新资料已创建', 'success');
  }
}

async function renameCurrentProfile() {
  if (!currentProfile) {
    showToast('当前没有选中的资料', 'warning');
    return;
  }
  const oldName = currentProfile.name || '默认资料';
  const newName = await showApplePrompt({
    title: '重命名当前资料档案',
    subtitle: '修改此份简历的名称，便于在投递不同岗位时快速识别',
    defaultValue: oldName,
    placeholder: '例如：前端开发版 / 字节跳动专版 / 英文外企版',
    confirmText: '保存修改'
  });
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) {
    showToast('资料档案名称不能为空', 'warning');
    return;
  }
  if (trimmed === oldName) return;

  const response = await sendMessage({
    action: 'updateProfile',
    profileId: activeProfileId,
    updates: { name: trimmed }
  });

  if (response && response.success) {
    currentProfile.name = trimmed;
    const select = document.getElementById('profileSelect');
    if (select) {
      const option = select.querySelector(`option[value="${activeProfileId}"]`);
      if (option) option.textContent = trimmed;
    }
    renderNavCustomDropdown();
    showToast(`✅ 资料档案已重命名为: 「${trimmed}」`, 'success');
  } else {
    showToast('重命名失败，请重试', 'error');
  }
}

function collectEducationData() {
  const education = [];
  document.querySelectorAll('#educationList .item-card').forEach((card) => {
    education.push({
      ...readExtendedFields(card),
      id: card.querySelector('.edu-school').getAttribute('data-id') || generateId(),
      school: card.querySelector('.edu-school').value.trim(),
      college: card.querySelector('.edu-college')?.value.trim() || '',
      major: card.querySelector('.edu-major').value.trim(),
      degree: card.querySelector('.edu-degree').value,
      degreeType: card.querySelector('.edu-degree-type')?.value || '',
      schoolType: card.querySelector('.edu-school-type')?.value || '',
      gpa: card.querySelector('.edu-gpa').value.trim(),
      rank: card.querySelector('.edu-rank')?.value.trim() || '',
      startDate: card.querySelector('.edu-start')?.value.trim() || '',
      endDate: card.querySelector('.edu-end')?.value.trim() || '',
      courses: card.querySelector('.edu-courses')?.value.trim() || '',
      description: card.querySelector('.edu-description')?.value.trim() || ''
    });
  });
  return education;
}

function collectWorkData() {
  const work = [];
  document.querySelectorAll('#workList .item-card').forEach((card) => {
    work.push({
      id: card.querySelector('.work-company').getAttribute('data-id') || generateId(),
      company: card.querySelector('.work-company').value.trim(),
      department: card.querySelector('.work-department')?.value.trim() || '',
      position: card.querySelector('.work-position').value.trim(),
      workType: card.querySelector('.work-type')?.value || '',
      city: card.querySelector('.work-city')?.value.trim() || '',
      startDate: card.querySelector('.work-start')?.value.trim() || '',
      endDate: card.querySelector('.work-end')?.value.trim() || '',
      description: card.querySelector('.work-desc').value.trim(),
      achievements: card.querySelector('.work-achievements')?.value.trim() || ''
    });
  });
  return work;
}

function collectProjectData() {
  const projects = [];
  document.querySelectorAll('#projectList .item-card').forEach((card) => {
    const tech = card.querySelector('.proj-tech')?.value.trim() || '';
    projects.push({
      ...readExtendedFields(card),
      id: card.querySelector('.proj-name').getAttribute('data-id') || generateId(),
      name: card.querySelector('.proj-name').value.trim(),
      role: card.querySelector('.proj-role').value.trim(),
      projectType: card.querySelector('.proj-type')?.value || '',
      techStack: tech,
      startDate: card.querySelector('.proj-start')?.value.trim() || '',
      endDate: card.querySelector('.proj-end')?.value.trim() || '',
      projectUrl: card.querySelector('.proj-url')?.value.trim() || '',
      description: card.querySelector('.proj-desc').value.trim(),
      responsibilities: card.querySelector('.proj-resp')?.value.trim() || '',
      achievements: card.querySelector('.proj-achieve')?.value.trim() || ''
    });
  });
  return projects;
}

function collectAwardsData() {
  const awards = [];
  document.querySelectorAll('#awardsList .item-card').forEach((card) => {
    awards.push({
      ...readExtendedFields(card),
      id: card.querySelector('.award-name').getAttribute('data-id') || generateId(),
      name: card.querySelector('.award-name').value.trim(),
      level: card.querySelector('.award-level')?.value || '',
      date: card.querySelector('.award-date')?.value.trim() || ''
    });
  });
  return awards;
}

function collectFamilyData() {
  return [...document.querySelectorAll('#familyList .item-card')].map((card) => ({
    ...readExtendedFields(card),
    id: card.querySelector('.family-name')?.getAttribute('data-id') || generateId(),
    name: card.querySelector('.family-name')?.value.trim() || '',
    relation: card.querySelector('.family-relation')?.value.trim() || '',
    employer: card.querySelector('.family-employer')?.value.trim() || '',
    position: card.querySelector('.family-position')?.value.trim() || '',
    phone: card.querySelector('.family-phone')?.value.trim() || ''
  }));
}

function collectCertificatesData() {
  return [...document.querySelectorAll('#certificatesList .item-card')].map((card) => ({
    id: card.querySelector('.certificate-name')?.getAttribute('data-id') || generateId(),
    name: card.querySelector('.certificate-name')?.value.trim() || '',
    code: card.querySelector('.certificate-code')?.value.trim() || '',
    issuer: card.querySelector('.certificate-issuer')?.value.trim() || '',
    date: card.querySelector('.certificate-date')?.value.trim() || '',
    expiryDate: card.querySelector('.certificate-expiry')?.value.trim() || ''
  }));
}

function collectProfileUpdates() {
  const updates = {
    basicInfo: {
      fullName: document.getElementById('fullName').value.trim(),
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      email: document.getElementById('email').value.trim(),
      gender: document.getElementById('gender').value,
      birthDate: document.getElementById('birthDate').value,
      idCard: document.getElementById('idCard').value.trim(),
      politicalStatus: document.getElementById('politicalStatus')?.value || '',
      ethnicity: document.getElementById('ethnicity')?.value.trim() || '',
      hometown: document.getElementById('hometown')?.value.trim() || '',
      graduationDate: document.getElementById('graduationDate')?.value.trim() || '',
      maritalStatus: document.getElementById('maritalStatus')?.value || '',
      currentCity: document.getElementById('currentCity')?.value.trim() || '',
      emergencyContact: document.getElementById('emergencyContact')?.value.trim() || '',
      emergencyRelation: document.getElementById('emergencyRelation')?.value.trim() || '',
      emergencyPhone: document.getElementById('emergencyPhone')?.value.trim() || '',
      city: document.getElementById('city').value.trim(),
      state: document.getElementById('state').value.trim(),
      country: document.getElementById('country').value.trim(),
      zipCode: document.getElementById('zipCode').value.trim(),
      street: document.getElementById('street').value.trim(),
      linkedin: document.getElementById('linkedin').value.trim(),
      github: document.getElementById('github').value.trim(),
      website: document.getElementById('website').value.trim(),
      twitter: document.getElementById('twitter').value.trim()
    },
    jobIntention: {
      expectedCity: document.getElementById('expectedCity')?.value.trim() || '',
      expectedPosition: document.getElementById('expectedPosition')?.value.trim() || '',
      expectedSalary: document.getElementById('expectedSalary')?.value.trim() || '',
      availableDate: document.getElementById('availableDate')?.value.trim() || '',
      referralCode: document.getElementById('referralCode')?.value.trim() || '',
      recruitSource: document.getElementById('recruitSource')?.value.trim() || '',
      willingToTravel: document.getElementById('willingToTravel')?.value || ''
    },
    languageSkills: {
      cet4: document.getElementById('cet4')?.value.trim() || '',
      cet6: document.getElementById('cet6')?.value.trim() || '',
      ielts: document.getElementById('ielts')?.value.trim() || '',
      toefl: document.getElementById('toefl')?.value.trim() || '',
      otherLanguages: document.getElementById('otherLanguages')?.value.trim() || ''
    },
    awards: collectAwardsData(),
    familyMembers: collectFamilyData(),
    certificates: collectCertificatesData(),
    education: collectEducationData(),
    workExperience: collectWorkData(),
    projects: collectProjectData(),
    skills: currentProfile?.skills || [],
    introTemplates: {
      default: document.getElementById('introduction').value.trim()
    },
    hrGreeting: document.getElementById('hrGreetingText')?.value.trim() || '',

  };
  const merged = mergeProfile(currentProfile || {}, collectExtendedProfile(updates));
  delete merged.attachments; delete merged.resumeFile; delete merged.resumeFileName;
  return merged;
}

function debouncedSave() {
  profileDirty = true;
  profileEditRevision++;
  clearTimeout(profileSaveTimer);
  profileSaveTimer = setTimeout(() => {
    saveProfile({ silent: true }).catch((error) => {
      console.error('[自动保存] 失败:', error);
    });
  }, 600);
}

function saveProfile({ silent = false } = {}) {
  clearTimeout(profileSaveTimer);
  const settings = collectAiSettingsFromDom();
  const snapshot = { silent, profileId: activeProfileId, updates: structuredClone(collectProfileUpdates()),
    settings: JSON.stringify(settings) === savedAiSettingsFingerprint ? null : settings, revision: profileEditRevision };
  pendingProfileSave = pendingProfileSave.catch(() => false).then(() => persistProfile(snapshot));
  return pendingProfileSave;
}

async function flushProfileSave() {
  clearTimeout(profileSaveTimer);
  for (const timer of [aiKeySaveTimer, aiUrlSaveTimer, aiModelSaveTimer, ocrSaveTimer]) clearTimeout(timer);
  modelFetchSeq++;
  const profileSaved = await (profileDirty ? saveProfile({ silent: true }) : pendingProfileSave);
  const settingsSaved = JSON.stringify(collectAiSettingsFromDom()) !== savedAiSettingsFingerprint
    ? await autoSaveAiSettings() : await pendingSettingsSave;
  return profileSaved && settingsSaved;
}

// 备份前由 background 定向请求各编辑页落盘；导入期间暂停编辑与定时保存。
chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  if (!editorDocumentId || request.documentId !== editorDocumentId) return;
  if (request.action === 'flushProfileEditor') {
    if (request.importing) document.body.inert = true;
    flushProfileSave().then(success => respond({ success })).catch(error => respond({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'finishProfileImport') {
    clearTimeout(profileSaveTimer);
    (async () => {
      try {
        if (request.success) { profileDirty = false; cancelOngoingAiParse(); await loadProfiles(); }
        respond({ success: true });
      } finally { document.body.inert = false; }
    })().catch(error => respond({ success: false, error: error.message }));
    return true;
  }
});

async function persistProfile({ silent, profileId, updates, settings, revision }) {
  if (!profileId) {
    if (!silent) showToast('没有可保存的资料', 'error');
    return false;
  }


  try {
    const response1 = await sendMessage({
      action: 'updateProfile',
      profileId,
      updates
    });
    const response2 = settings ? await sendMessage({ action: 'updateSettings', settings }) : { success: true };
    if (settings && response2.success) savedAiSettingsFingerprint = JSON.stringify(settings);

    if (response1.success && response2.success) {
      if (profileId === activeProfileId) {
        currentProfile = mergeProfile(currentProfile || {}, { ...updates, id: profileId });
        if (revision === profileEditRevision) profileDirty = false;
      }
      if (typeof appLog !== 'undefined') appLog.success('options', 'profile.save', silent ? '资料已静默保存' : '资料已保存');
      if (!silent) showToast('资料与设置已保存', 'success');
      return true;
    }

    showToast(response1.error || response2.error || '保存失败，请重试', 'error');
    return false;
  } catch (error) {
    console.error('[保存] 失败:', error);
    showToast('保存失败: ' + error.message, 'error');
    return false;
  }
}

function addEducation() {
  if (!currentProfile) return;
  currentProfile.education = collectEducationData();
  currentProfile.education.push(emptyEducation());
  renderEducationList(currentProfile.education);
  debouncedSave();
}

async function deleteEducation(eduId) {
  const ok = await showAppleConfirm({
    title: '删除教育经历',
    subtitle: '确定要删除这条教育背景信息吗？删除后需手动重新填写',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.education = collectEducationData().filter((item) => item.id !== eduId);
  if (currentProfile.education.length === 0) currentProfile.education.push(emptyEducation());
  renderEducationList(currentProfile.education);
  debouncedSave();
}

function addWorkExperience() {
  if (!currentProfile) return;
  currentProfile.workExperience = collectWorkData();
  currentProfile.workExperience.push(emptyWork());
  renderWorkList(currentProfile.workExperience);
  debouncedSave();
}

async function deleteWorkExperience(workId) {
  const ok = await showAppleConfirm({
    title: '删除工作经历',
    subtitle: '确定要删除这条工作/实习经历记录吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.workExperience = collectWorkData().filter((item) => item.id !== workId);
  if (currentProfile.workExperience.length === 0) currentProfile.workExperience.push(emptyWork());
  renderWorkList(currentProfile.workExperience);
  debouncedSave();
}

function addProject() {
  if (!currentProfile) return;
  currentProfile.projects = collectProjectData();
  currentProfile.projects.push(emptyProject());
  renderProjectList(currentProfile.projects);
  debouncedSave();
}

async function deleteProject(projectId) {
  const ok = await showAppleConfirm({
    title: '删除项目经历',
    subtitle: '确定要删除这条项目经历记录吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.projects = collectProjectData().filter((item) => item.id !== projectId);
  if (currentProfile.projects.length === 0) currentProfile.projects.push(emptyProject());
  renderProjectList(currentProfile.projects);
  debouncedSave();
}

function addAward() {
  if (!currentProfile) return;
  currentProfile.awards = collectAwardsData();
  currentProfile.awards.push(emptyAward());
  renderAwardsList(currentProfile.awards);
  debouncedSave();
}

async function deleteAward(awardId) {
  const ok = await showAppleConfirm({
    title: '删除荣誉奖项',
    subtitle: '确定要删除这条奖项/证书记录吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.awards = collectAwardsData().filter((item) => item.id !== awardId);
  if (currentProfile.awards.length === 0) currentProfile.awards.push(emptyAward());
  renderAwardsList(currentProfile.awards);
  debouncedSave();
}

function addFamilyMember() {
  if (!currentProfile) return;
  currentProfile.familyMembers = collectFamilyData();
  currentProfile.familyMembers.push(emptyFamilyMember());
  renderFamilyList(currentProfile.familyMembers);
  debouncedSave();
}

async function deleteFamilyMember(memberId) {
  const ok = await showAppleConfirm({
    title: '删除家庭成员',
    subtitle: '确定要删除这条家庭成员信息吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.familyMembers = collectFamilyData().filter((item) => item.id !== memberId);
  if (!currentProfile.familyMembers.length) currentProfile.familyMembers.push(emptyFamilyMember());
  renderFamilyList(currentProfile.familyMembers);
  debouncedSave();
}

function addCertificate() {
  if (!currentProfile) return;
  currentProfile.certificates = collectCertificatesData();
  currentProfile.certificates.push(emptyCertificate());
  renderCertificatesList(currentProfile.certificates);
  debouncedSave();
}

async function deleteCertificate(certificateId) {
  const ok = await showAppleConfirm({
    title: '删除资格证书',
    subtitle: '确定要删除这条资格证书信息吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.certificates = collectCertificatesData().filter((item) => item.id !== certificateId);
  if (!currentProfile.certificates.length) currentProfile.certificates.push(emptyCertificate());
  renderCertificatesList(currentProfile.certificates);
  debouncedSave();
}

function addSkill() {
  const input = document.getElementById('skillInput');
  const skill = input.value.trim();
  if (!skill) return;
  if (!currentProfile.skills) currentProfile.skills = [];
  if (!currentProfile.skills.includes(skill)) {
    currentProfile.skills.push(skill);
    renderSkillsList(currentProfile.skills);
  debouncedSave();
  }
  input.value = '';
}

function removeSkill(skill) {
  currentProfile.skills = (currentProfile.skills || []).filter((item) => item !== skill);
  renderSkillsList(currentProfile.skills);
  debouncedSave();
}

function loadIntroductionTemplate(type) {
  const templates = {
    tech: '热爱计算机与前沿技术，具备扎实的计算机基础与全栈项目实践经验，善于钻研技术难点，具备良好的工程规范与团队协作能力...',
    product: '具备严密的逻辑思维与同理心，熟悉互联网产品全流程生命周期，擅长需求分析、数据洞察与跨部门沟通协同...',
    ops: '对互联网运营充满热情，具备优秀的用户增长意识、内容策划能力与数据复盘能力，具备极强的执行力与自驱力...'
  };
  document.getElementById('introduction').value = templates[type] || '';
  debouncedSave();
}

function updateResumeAttachmentUI(fileName, fileSize = 0) {
  const card = document.getElementById('resumeAttachmentCard');
  const nameEl = document.getElementById('resumeFileName');
  const sizeEl = document.getElementById('resumeFileSize');
  const btnText = document.getElementById('aiUploadBtnText');
  if (!card || !nameEl) return;

  if (fileName) {
    card.style.display = 'flex';
    nameEl.textContent = fileName;
    if (sizeEl) {
      sizeEl.textContent = fileSize ? `（${formatAiFileSize(fileSize)}）` : '';
    }
    if (btnText) btnText.textContent = '更换简历源文件';
  } else {
    card.style.display = 'none';
    nameEl.textContent = '未上传简历文件';
    if (sizeEl) sizeEl.textContent = '';
    if (btnText) btnText.textContent = '上传 / 导入简历源文件';
  }
}

function setAiFileStatus(message, state = 'selected') {
  const status = document.getElementById('aiFileStatus');
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || '';
  status.className = `ai-file-status is-${state}`;
}

function clearSelectedAiResumeFile({ keepStatus = false } = {}) {
  cancelOngoingAiParse();
  selectedAiResumeFile = null;
  const input = document.getElementById('aiResumeFile');
  if (input) input.value = '';
  if (!keepStatus) setAiFileStatus('');
}

function formatAiFileSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function handleAiParseProgress(progress, button) {
  if (!progress || !progress.message) return;
  let state = 'text';
  if (progress.stage === 'direct') state = 'direct';
  if (progress.stage === 'ocr' || progress.stage === 'ocr-complete') state = 'ocr';
  if (progress.stage === 'fallback' || progress.stage === 'ocr-fallback') state = 'fallback';
  setAiFileStatus(progress.message, state);
  const label = button && button.querySelector('span');
  if (label) label.textContent = progress.message.replace(/…$/, '');
}

function handleAiFileImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  if (!resumeParser.isSupported(file)) {
    clearSelectedAiResumeFile();
    showToast('不支持的文件格式，请使用 PDF / Word / 图片 / TXT / MD / LaTeX / HTML', 'error');
    return;
  }

  // 新简历上传时中断上一轮还在进行的解析
  cancelOngoingAiParse();
  selectedAiResumeFile = file;

  // 自动保留源文件（用于网申页面自动上传简历附件）
  saveAttachmentFile('resume', file).catch(error => showToast(error.message, 'error'));

  document.getElementById('resumeText').value = '';
  setAiFileStatus(
    `已就绪：${file.name}（${formatAiFileSize(file.size)}），已自动绑定为网申简历附件；点击下方按钮即可一键解析。`,
    'selected'
  );
  showToast(`已上传 ${file.name} 并保存为简历源文件`, 'success');
}

function ensurePdfJs() {
  if (typeof pdfjsLib !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = '../vendor/pdfjs/pdf.min.js';
    el.onload = resolve;
    el.onerror = () => reject(new Error('PDF 引擎加载失败'));
    document.head.appendChild(el);
  });
}

async function parseResumeText() {
  const resumeTextArea = document.getElementById('resumeText');
  const resumeText = resumeTextArea.value.trim();
  const resumeFile = selectedAiResumeFile;
  if (!resumeFile && !resumeText) {
    showToast('请先粘贴简历内容，或从文件导入', 'warning');
    return;
  }

  const settings = collectAiSettingsFromDom();
  if (!settings.aiEnabled) {
    showToast('请先勾选启用 AI 功能', 'warning');
    return;
  }
  if (!settings.aiApiKey) {
    showToast('请先填写 API Key', 'warning');
    return;
  }
  if (!settings.aiModel) {
    showToast('请先获取并选择模型', 'warning');
    return;
  }

  await autoSaveAiSettings();

  const btn = document.getElementById('parseTextBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-ring" style="width:14px;height:14px;border-width:2px;"></div><span>正在全量智能解析简历...</span>';
  showToast('正在解析简历，请稍候...', 'info');
  if (typeof appLog !== 'undefined') {
    appLog.info('options', 'parse.click', resumeFile ? `开始解析文件 ${resumeFile.name}` : '开始解析粘贴文本');
  }

  const runId = ++aiParseRunSeq;

  try {
    let parsedData;
    let parseResult = null;
    if (resumeFile) {
      if (/\.pdf$/i.test(resumeFile.name) || resumeFile.type === 'application/pdf') {
        await ensurePdfJs();
      }
      parseResult = await resumeParser.parseFileWithAI(resumeFile, settings, {
        fallbackText: resumeText,
        onProgress: (progress) => handleAiParseProgress(progress, btn)
      });

      // 等待期间用户重新上传了简历/切换了资料，本轮结果作废（须在改动任何 UI 前判断）
      if (runId !== aiParseRunSeq) return;

      parsedData = parseResult.data;

      if (parseResult.inputMode === 'text') {
        resumeTextArea.value = parseResult.extractedText || '';
        clearSelectedAiResumeFile({ keepStatus: true });
        const usedOcr = parseResult.extractionMode === 'ocr';
        setAiFileStatus(
          usedOcr
            ? `${parseResult.fileName} 已用 OCR 识别后再解析；识别文字已保留。`
            : `${parseResult.fileName} 已用本地抽取文字再解析；提取文字已保留。`,
          usedOcr ? 'ocr' : 'fallback'
        );
      } else {
        setAiFileStatus(`${parseResult.fileName} 已由当前模型直接读取。`, 'direct');
      }
    } else {
      parsedData = await resumeParser.parseWithAI(resumeText, settings);

      if (runId !== aiParseRunSeq) return;
    }

    fillParsedData(parsedData);
    const saved = await saveProfile({ silent: true });
    if (saved) {
      const modeText = parseResult?.inputMode === 'file'
        ? '模型已直接读取原始文件'
        : parseResult?.extractionMode === 'ocr'
          ? 'OCR 识别后由文本模型解析完成'
        : parseResult?.inputMode === 'text'
          ? '已自动回退本地文字解析'
          : '文字解析完成';
      showToast(`✅ ${modeText}，已写入表单并保存`, 'success');
      if (typeof appLog !== 'undefined') appLog.success('options', 'parse.save', modeText + '，已保存');
    } else {
      showToast('解析已写入表单，但保存失败，请再点保存', 'warning');
      if (typeof appLog !== 'undefined') appLog.warn('options', 'parse.save', '解析已写入表单，但保存失败');
    }
  } catch (error) {
    if (error.message === '解析已取消') {
      showToast('已取消上一轮解析', 'info');
      if (typeof appLog !== 'undefined') appLog.info('options', 'parse.cancel', '重新上传/切换资料，已中断上一轮解析');
      return;
    }
    console.error('[AI解析] 失败:', error);
    if (typeof appLog !== 'undefined') appLog.error('options', 'parse.fail', '解析失败', error.message);
    if (resumeFile) setAiFileStatus(`解析失败：${error.message}`, 'error');
    showToast(`❌ 解析失败: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function fillParsedData(data) {
  if (!currentProfile) {
    throw new Error('当前没有资料，请先创建一份');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('AI 返回的数据格式不正确');
  }

  currentProfile = mergeProfile(currentProfile, collectProfileUpdates());
  currentProfile.basicInfo = currentProfile.basicInfo || {};
  const bi = data.basicInfo || {};
  const basicFields = [
    'fullName', 'firstName', 'lastName', 'phone', 'email', 'gender',
    'politicalStatus', 'ethnicity', 'hometown', 'graduationDate', 'maritalStatus', 'currentCity',
    'emergencyContact', 'emergencyRelation', 'emergencyPhone',
    'city', 'state', 'country', 'zipCode', 'street',
    'linkedin', 'github', 'website', 'twitter'
  ];
  basicFields.forEach((key) => {
    if (bi[key]) {
      setInputValue(key, bi[key]);
      currentProfile.basicInfo[key] = bi[key];
    }
  });
  if (bi.birthDate) {
    const birth = toDateInput(bi.birthDate);
    if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(birth)) {
      setInputValue('birthDate', birth);
      currentProfile.basicInfo.birthDate = birth;
    }
  }

  // 求职意向
  currentProfile.jobIntention = currentProfile.jobIntention || {};
  const ji = data.jobIntention || {};
  ['expectedCity', 'expectedPosition', 'expectedSalary', 'availableDate', 'referralCode', 'recruitSource', 'willingToTravel'].forEach(key => {
    if (ji[key]) {
      setInputValue(key, ji[key]);
      currentProfile.jobIntention[key] = ji[key];
    }
  });

  // 语言能力
  currentProfile.languageSkills = currentProfile.languageSkills || {};
  const ls = data.languageSkills || {};
  ['cet4', 'cet6', 'ielts', 'toefl', 'otherLanguages'].forEach(key => {
    if (ls[key]) {
      setInputValue(key, ls[key]);
      currentProfile.languageSkills[key] = ls[key];
    }
  });

  if (data.familyMembers && data.familyMembers.length) {
    currentProfile.familyMembers = data.familyMembers.map((item) => ({ ...emptyFamilyMember(), ...item, id: generateId() }));
    renderFamilyList(currentProfile.familyMembers);
  }

  if (data.certificates && data.certificates.length) {
    currentProfile.certificates = normalizeCertificates(data.certificates);
    renderCertificatesList(currentProfile.certificates);
  }

  // 荣誉奖项
  if (data.awards && data.awards.length) {
    currentProfile.awards = data.awards.map(item => ({ ...emptyAward(), ...item, id: generateId() }));
    renderAwardsList(currentProfile.awards);
  }

  // 教育背景
  if (data.education && data.education.length) {
    currentProfile.education = data.education.map((item) => ({ ...emptyEducation(), ...item, id: generateId() }));
    renderEducationList(currentProfile.education);
  }

  // 工作经历
  if (data.workExperience && data.workExperience.length) {
    currentProfile.workExperience = data.workExperience.map((item) => ({ ...emptyWork(), ...item, id: generateId() }));
    renderWorkList(currentProfile.workExperience);
  }

  // 项目经历
  if (data.projects && data.projects.length) {
    currentProfile.projects = data.projects.map((item) => ({ ...emptyProject(), ...item, id: generateId() }));
    renderProjectList(currentProfile.projects);
  }

  // 技能标签
  if (data.skills && data.skills.length) {
    currentProfile.skills = data.skills;
    renderSkillsList(currentProfile.skills);
  }

  // 自我介绍
  if (data.introduction) {
    document.getElementById('introduction').value = data.introduction;
    currentProfile.introTemplates = currentProfile.introTemplates || { default: '', custom: [] };
    currentProfile.introTemplates.default = data.introduction;
  }
  for (const section of Object.keys(profileSchema)) {
    if (profileListKeys.includes(section)) {
      if (['papers', 'patents', 'openSource', 'customAnswers', 'declarations'].includes(section) && data[section]?.length) {
        currentProfile[section] = data[section].map(item => ({ ...item, id: generateId() }));
      }
    } else {
      for (const key of Object.keys(profileSchema[section])) {
        if (data[section]?.[key]?.length) currentProfile[section][key] = data[section][key];
      }
    }
  }
  renderExtendedProfile(currentProfile);

}

async function deleteCurrentProfile() {
  const ok = await showAppleConfirm({
    title: '删除当前资料档案',
    subtitle: `确定要删除「${currentProfile?.name || '当前资料'}」吗？此操作不可撤销`,
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  const response = await sendMessage({ action: 'deleteProfile', profileId: activeProfileId });
  if (response.success) {
    clearSelectedAiResumeFile();
    await loadProfiles();
    showToast('资料已删除', 'success');
  } else {
    showToast('至少需要保留一份资料', 'warning');
  }
}

function autoSaveAiSettings() {
  const settings = collectAiSettingsFromDom();
  pendingSettingsSave = pendingSettingsSave.catch(() => false).then(async () => {
    try {
      const response = await sendMessage({ action: 'updateSettings', settings });
      if (response?.success) savedAiSettingsFingerprint = JSON.stringify(settings);
      return !!response?.success;
    } catch (error) {
      console.error('[AI设置] 自动保存失败:', error);
      return false;
    }
  });
  return pendingSettingsSave;
}

async function testAiConnection() {
  const settings = collectAiSettingsFromDom();
  if (!settings.aiApiKey) {
    showToast('请先输入 API Key', 'warning');
    return;
  }

  settings.aiEnabled = true;
  document.getElementById('aiEnabled').checked = true;
  document.getElementById('aiSettings').style.display = 'block';

  if (!settings.aiModel) {
    const models = await refreshModelList({ silent: true });
    settings.aiModel = getSelectedModel() || models[0] || '';
  }

  if (!settings.aiModel) {
    showToast('请先获取并选择模型', 'warning');
    setModelHint('测试前需要先选出一个模型', true);
    return;
  }

  await autoSaveAiSettings();

  const btn = document.getElementById('testAiBtn');
  const resultDiv = document.getElementById('testResult');
  btn.disabled = true;
  btn.textContent = '🔍 测试中...';
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div style="color: #818cf8;">正在连接大模型服务...</div>';

  try {
    const startTime = Date.now();
    const result = await resumeParser.testConnection(settings);
    const duration = Date.now() - startTime;
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>测试连接</span>';
    resultDiv.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 12px; border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.35);">
        <strong>✅ 接口连接成功</strong><br>
        使用模型: ${html(result.model || settings.aiModel)}<br>
        响应耗时: ${duration}ms<br>
        模型回复: ${html(result.preview || 'OK')}
      </div>
    `;
    showToast('✅ AI连接测试成功', 'success');
  } catch (error) {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>测试连接</span>';
    console.error('[AI测试] 失败:', error);

    let errorType = '请求失败';
    let suggestion = '查看下方详细错误';
    const message = error.message || '';
    if (/401|403|unauthorized|invalid api key/i.test(message)) {
      errorType = 'API Key 无效或未授权';
      suggestion = '请检查 API Key 是否完整粘贴，前后是否有空格';
    } else if (/failed to fetch|network|连接失败/i.test(message)) {
      errorType = '网络连接失败';
      suggestion = '检查网络连接，或尝试配置代理/中转 API URL';
    } else if (/model/i.test(message)) {
      errorType = '模型不可用';
      suggestion = '点击「获取可用模型」后改选列表中的模型；豆包请选 ep- 接入点';
    } else if (/balance|quota|额度|余额/i.test(message)) {
      errorType = '账号余额不足';
      suggestion = '请登录对应大模型平台控制台充值后再试';
    }

    resultDiv.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.15); color: #f87171; padding: 12px; border-radius: 12px; border: 1px solid rgba(239, 68, 68, 0.35);">
        <strong>❌ 连接失败：${html(errorType)}</strong><br>
        <div style="margin-top: 6px; font-size: 11.5px;">${html(suggestion)}</div>
        <details style="margin-top: 6px;">
          <summary style="cursor: pointer; font-size: 11px;">查看详细错误日志</summary>
          <pre style="margin-top: 4px; font-size: 10.5px; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap;">${html(message)}</pre>
        </details>
      </div>
    `;
    showToast(`❌ 测试失败: ${errorType}`, 'error');
  }
}

async function testOcrConnection() {
  const ocrApiKey = document.getElementById('ocrApiKey')?.value.trim();
  if (!ocrApiKey) {
    showToast('请先输入硅基流动 API Key', 'warning');
    return;
  }

  await autoSaveAiSettings();

  const btn = document.getElementById('testOcrBtn');
  const resultDiv = document.getElementById('testOcrResult');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner-ring" style="width:11px;height:11px;border-width:2px;"></div><span>测试中...</span>';
  }
  if (resultDiv) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="color: #d97757; font-size: 12px; padding: 6px 0;">正在连接硅基流动 DeepSeek-OCR 服务...</div>';
  }

  try {
    const startTime = Date.now();
    const result = await resumeParser.testOcrConnection(ocrApiKey);
    const duration = Date.now() - startTime;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>测试 OCR 连通性</span>';
    }
    if (resultDiv) {
      resultDiv.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.12); color: #10b981; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.25); font-size: 12px; margin-top: 8px;">
          <strong>✅ 硅基流动 DeepSeek-OCR 连接成功</strong><br>
          模型: ${html(result.model)} · 响应耗时: ${duration}ms
        </div>
      `;
    }
    showToast('✅ 硅基流动 OCR 服务连接成功！', 'success');
  } catch (error) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>测试 OCR 连通性</span>';
    }
    if (resultDiv) {
      resultDiv.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.12); color: #ef4444; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.25); font-size: 12px; margin-top: 8px;">
          <strong>❌ 硅基流动 OCR 连接失败</strong><br>
          ${html(error.message)}
        </div>
      `;
    }
    showToast('OCR 连接失败，请检查 API Key', 'error');
  }
}

let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(toastTimer);

  const rawMsg = String(message || '').trim();
  const emojiMatch = rawMsg.match(/^([\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{2300}-\u{23FF}])/u);
  let iconHtml = '';
  let displayText = rawMsg;

  if (emojiMatch) {
    iconHtml = `<span class="toast-emoji">${emojiMatch[0]}</span>`;
    displayText = rawMsg.slice(emojiMatch[0].length).trim();
  } else {
    const svgs = {
      success: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>',
      error: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
      warning: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };
    iconHtml = svgs[type] || svgs.info;
  }

  toast.innerHTML = `${iconHtml}<span>${html(displayText)}</span>`;
  toast.className = `toast ${type}`;
  toast.style.display = 'inline-flex';
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0) scale(1)';

  toastTimer = setTimeout(() => {
    toast.style.transition = 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-10px) scale(0.94)';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 240);
  }, 2200);
}

function updateGreetingCharCount(text) {
  const countEl = document.getElementById('greetingCharCount');
  if (countEl) {
    const len = String(text || '').length;
    countEl.textContent = `${len} / 300 字`;
    countEl.style.color = len > 300 ? '#ef4444' : '';
  }
}

// ============================================================================
// 投递历史与网申看板逻辑
// ============================================================================

let allSubmissions = [];
let submissionFilterStatus = 'all';
let submissionSearchQuery = '';

async function loadSubmissions() {
  try {
    const response = await sendMessage({ action: 'getSubmissions' });
    allSubmissions = response.success && Array.isArray(response.submissions) ? response.submissions : [];
    updateSubmissionStats();
    renderSubmissionsList();
  } catch (e) {
    console.error('[投递历史] 加载失败:', e);
  }
}

function updateSubmissionStats() {
  const total = allSubmissions.length;
  const pending = allSubmissions.filter((s) => s.status === '在投').length;
  const exam = allSubmissions.filter((s) => s.status === '笔试').length;
  const interview = allSubmissions.filter((s) => s.status === '面试').length;
  const offer = allSubmissions.filter((s) => s.status === 'Offer').length;
  const rejected = allSubmissions.filter((s) => s.status === '挂了').length;

  const totalEl = document.getElementById('statTotal');
  const pendingEl = document.getElementById('statPending');
  const examEl = document.getElementById('statExam');
  const interviewEl = document.getElementById('statInterview');
  const offerEl = document.getElementById('statOffer');
  const rejectedEl = document.getElementById('statRejected');

  if (totalEl) totalEl.textContent = total;
  if (pendingEl) pendingEl.textContent = pending;
  if (examEl) examEl.textContent = exam;
  if (interviewEl) interviewEl.textContent = interview;
  if (offerEl) offerEl.textContent = offer;
  if (rejectedEl) rejectedEl.textContent = rejected;

  const navKanbanCount = document.getElementById('navKanbanCount');
  if (navKanbanCount) navKanbanCount.textContent = total;

  document.querySelectorAll('.stat-card').forEach((card) => {
    const status = card.getAttribute('data-status');
    card.classList.toggle('active', status === submissionFilterStatus);
  });
}

function renderSubmissionsList() {
  const container = document.getElementById('submissionList');
  if (!container) return;

  const query = submissionSearchQuery.trim().toLowerCase();
  const filtered = allSubmissions.filter((item) => {
    if (submissionFilterStatus !== 'all' && item.status !== submissionFilterStatus) {
      return false;
    }
    if (query) {
      const matchCompany = (item.company || '').toLowerCase().includes(query);
      const matchPosition = (item.position || '').toLowerCase().includes(query);
      const matchProfile = (item.profileName || '').toLowerCase().includes(query);
      const matchNotes = (item.notes || '').toLowerCase().includes(query);
      if (!matchCompany && !matchPosition && !matchProfile && !matchNotes) return false;
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="submission-empty">
        <div style="font-size: 32px; margin-bottom: 10px;">📬</div>
        <div style="font-size: 15px; font-weight: 650; color: var(--text-main); margin-bottom: 6px;">暂无匹配的投递记录</div>
        <div style="font-size: 13px; color: var(--text-muted);">在招聘网站点击悬浮窗「⚡ 填充」时会自动提取记录，也可以点击右上角「+ 手动添加投递」</div>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach((sub) => {
    const card = document.createElement('div');
    card.className = 'submission-item-card';

    const companyName = sub.company || '未知企业';
    const positionName = sub.position || '网申岗位';
    const dateStr = sub.date || new Date().toISOString().slice(0, 10);
    const profileName = sub.profileName || '默认资料';
    const currStatus = sub.status || '在投';

    const urlDisplay = sub.url ? `
      <a href="${attr(sub.url)}" target="_blank" rel="noreferrer" class="sub-link-chip" title="${attr(sub.url)}">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
        <span>职位与网申网址</span>
      </a>` : '';

    const notesDisplay = sub.notes ? `
      <div class="sub-notes-box">
        <span class="notes-icon">📝</span>
        <span class="notes-text" title="${attr(sub.notes)}"><strong>复盘/备注：</strong>${html(sub.notes)}</span>
      </div>` : '';

    card.innerHTML = `
      <div class="sub-item-main">
        <div class="sub-item-top">
          <div class="sub-company-wrap">
            <span class="sub-company-icon">🏢</span>
            <span class="sub-company-name">${html(companyName)}</span>
          </div>
          <div class="sub-position-wrap">
            <span class="sub-position-badge">🎯 ${html(positionName)}</span>
          </div>
        </div>
        <div class="sub-item-meta">
          <span class="sub-meta-pill">📅 投递日期: ${html(dateStr)}</span>
          <span class="sub-meta-pill">📄 资料: ${html(profileName)}</span>
          ${urlDisplay}
        </div>
        ${notesDisplay}
      </div>
      <div class="sub-item-actions">
        <div class="apple-status-dropdown-box" data-id="${attr(sub.id)}">
          <button type="button" class="apple-status-pill status-${attr(currStatus)}" title="点击切换当前投递状态">
            <span class="status-dot dot-${attr(currStatus)}"></span>
            <span class="status-text">${html(currStatus)}</span>
            <svg class="status-arrow" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div class="apple-status-menu">
            <div class="apple-status-opt ${currStatus === '在投' ? 'active' : ''}" data-status="在投"><span class="opt-dot dot-在投"></span><span>在投</span>${currStatus === '在投' ? '<span class="check">✓</span>' : ''}</div>
            <div class="apple-status-opt ${currStatus === '笔试' ? 'active' : ''}" data-status="笔试"><span class="opt-dot dot-笔试"></span><span>笔试</span>${currStatus === '笔试' ? '<span class="check">✓</span>' : ''}</div>
            <div class="apple-status-opt ${currStatus === '面试' ? 'active' : ''}" data-status="面试"><span class="opt-dot dot-面试"></span><span>面试</span>${currStatus === '面试' ? '<span class="check">✓</span>' : ''}</div>
            <div class="apple-status-opt ${currStatus === 'Offer' ? 'active' : ''}" data-status="Offer"><span class="opt-dot dot-Offer"></span><span>Offer</span>${currStatus === 'Offer' ? '<span class="check">✓</span>' : ''}</div>
            <div class="apple-status-opt ${currStatus === '挂了' ? 'active' : ''}" data-status="挂了"><span class="opt-dot dot-挂了"></span><span>挂了</span>${currStatus === '挂了' ? '<span class="check">✓</span>' : ''}</div>
          </div>
        </div>
        <button type="button" class="btn-icon-sub btn-edit-sub" data-id="${attr(sub.id)}" title="编辑投递详情与复盘">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button type="button" class="btn-icon-sub btn-del-sub" data-id="${attr(sub.id)}" title="删除此条记录">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    // 状态胶囊点击展开/收起
    const statusBox = card.querySelector('.apple-status-dropdown-box');
    const statusPill = card.querySelector('.apple-status-pill');
    statusPill.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = statusBox.classList.contains('is-open');
      document.querySelectorAll('.apple-status-dropdown-box.is-open').forEach(b => b.classList.remove('is-open'));
      document.querySelectorAll('.apple-custom-select-box.is-open').forEach(b => b.classList.remove('is-open'));
      if (!isOpen) statusBox.classList.add('is-open');
    });

    // 状态选项切换
    card.querySelectorAll('.apple-status-opt').forEach((opt) => {
      opt.addEventListener('click', async (e) => {
        e.stopPropagation();
        statusBox.classList.remove('is-open');
        const newStatus = opt.getAttribute('data-status');
        const subId = statusBox.getAttribute('data-id');
        if (newStatus && newStatus !== currStatus) {
          await updateSubmissionStatus(subId, newStatus);
        }
      });
    });

    // 编辑按钮
    const editBtn = card.querySelector('.btn-edit-sub');
    editBtn.addEventListener('click', () => {
      const subId = editBtn.getAttribute('data-id');
      const item = allSubmissions.find((s) => s.id === subId);
      if (item) openSubmissionEditModal(item);
    });

    // 删除按钮
    const delBtn = card.querySelector('.btn-del-sub');
    delBtn.addEventListener('click', async () => {
      const subId = delBtn.getAttribute('data-id');
      await deleteSubmissionRecord(subId);
    });

    container.appendChild(card);
  });
}

async function updateSubmissionStatus(id, newStatus) {
  try {
    const res = await sendMessage({ action: 'updateSubmission', id, updates: { status: newStatus } });
    if (res && res.success) {
      const target = allSubmissions.find((s) => s.id === id);
      if (target) target.status = newStatus;
      updateSubmissionStats();
      renderSubmissionsList();
      showToast(`已更新为「${newStatus}」状态`, 'success');
    }
  } catch (e) {
    showToast('状态更新失败', 'error');
  }
}

function openSubmissionEditModal(submission = null) {
  const modal = document.getElementById('submissionEditModal');
  if (!modal) return;

  const profileSelect = document.getElementById('editSubmissionProfile');
  profileSelect.innerHTML = '';
  allProfiles.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    profileSelect.appendChild(opt);
  });

  const titleEl = document.getElementById('submissionModalTitle');
  const idEl = document.getElementById('editSubmissionId');
  const compEl = document.getElementById('editSubmissionCompany');
  const posEl = document.getElementById('editSubmissionPosition');
  const dateEl = document.getElementById('editSubmissionDate');
  const statusSelect = document.getElementById('editSubmissionStatus');
  const urlEl = document.getElementById('editSubmissionUrl');
  const notesEl = document.getElementById('editSubmissionNotes');

  if (submission) {
    titleEl.textContent = '✏️ 修改投递记录';
    idEl.value = submission.id || '';
    compEl.value = submission.company || '';
    posEl.value = submission.position || '';
    dateEl.value = submission.date || new Date().toISOString().slice(0, 10);
    statusSelect.value = submission.status || '在投';
    profileSelect.value = submission.profileId || activeProfileId;
    urlEl.value = submission.url || '';
    notesEl.value = submission.notes || '';
  } else {
    titleEl.textContent = '➕ 添加投递记录';
    idEl.value = '';
    compEl.value = '';
    posEl.value = '';
    dateEl.value = new Date().toISOString().slice(0, 10);
    statusSelect.value = '在投';
    profileSelect.value = activeProfileId;
    urlEl.value = '';
    notesEl.value = '';
  }

  // 升级模态框内部下拉框为 Apple Select
  profileSelect.removeAttribute('data-apple-select-initialized');
  const oldBox1 = profileSelect.parentNode?.querySelector('.apple-custom-select-box');
  if (oldBox1) oldBox1.remove();
  upgradeToAppleSelect(profileSelect);

  statusSelect.removeAttribute('data-apple-select-initialized');
  const oldBox2 = statusSelect.parentNode?.querySelector('.apple-custom-select-box');
  if (oldBox2) oldBox2.remove();
  upgradeToAppleSelect(statusSelect);

  modal.style.display = 'block';
  compEl.focus();
}

function closeSubmissionEditModal() {
  const modal = document.getElementById('submissionEditModal');
  if (modal) modal.style.display = 'none';
}

async function saveSubmissionFromModal() {
  const comp = document.getElementById('editSubmissionCompany').value.trim();
  const pos = document.getElementById('editSubmissionPosition').value.trim();
  if (!comp || !pos) {
    showToast('请填写目标公司和岗位名称', 'warning');
    return;
  }

  const id = document.getElementById('editSubmissionId').value.trim();
  const date = document.getElementById('editSubmissionDate').value || new Date().toISOString().slice(0, 10);
  const status = document.getElementById('editSubmissionStatus').value || '在投';
  const profileId = document.getElementById('editSubmissionProfile').value;
  const selectedProf = allProfiles.find((p) => p.id === profileId);
  const profileName = selectedProf ? selectedProf.name : '默认资料';
  const url = document.getElementById('editSubmissionUrl').value.trim();
  const notes = document.getElementById('editSubmissionNotes').value.trim();

  const data = { company: comp, position: pos, date, status, profileId, profileName, url, notes };

  try {
    if (id) {
      await sendMessage({ action: 'updateSubmission', id, updates: data });
      showToast('✅ 投递记录已更新', 'success');
    } else {
      await sendMessage({ action: 'addSubmission', data });
      showToast('✅ 投递记录已添加', 'success');
    }
    closeSubmissionEditModal();
    await loadSubmissions();
  } catch (e) {
    showToast(`保存失败: ${e.message}`, 'error');
  }
}

async function deleteSubmissionRecord(id) {
  const ok = await showAppleConfirm({
    title: '删除投递记录',
    subtitle: '确定要删除这条公司的投递记录吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  try {
    const res = await sendMessage({ action: 'deleteSubmission', id });
    if (res && res.success) {
      allSubmissions = allSubmissions.filter((s) => s.id !== id);
      updateSubmissionStats();
      renderSubmissionsList();
      showToast('投递记录已删除', 'success');
    }
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

function exportSubmissionsCsv() {
  if (!allSubmissions.length) {
    showToast('暂无投递记录可导出', 'warning');
    return;
  }

  const headers = ['公司名称', '投递岗位', '投递日期', '当前进度', '所用资料', '招聘网址', '备注复盘'];
  const rows = allSubmissions.map((s) => [
    `"${(s.company || '').replace(/"/g, '""')}"`,
    `"${(s.position || '').replace(/"/g, '""')}"`,
    `"${(s.date || '').replace(/"/g, '""')}"`,
    `"${(s.status || '').replace(/"/g, '""')}"`,
    `"${(s.profileName || '').replace(/"/g, '""')}"`,
    `"${(s.url || '').replace(/"/g, '""')}"`,
    `"${(s.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `秋招投递记录_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('✅ 投递记录已导出为 CSV 表格', 'success');
}

function bindSubmissionEvents() {
  document.getElementById('addSubmissionBtn')?.addEventListener('click', () => openSubmissionEditModal(null));
  document.getElementById('closeSubmissionModalBtn')?.addEventListener('click', closeSubmissionEditModal);
  document.getElementById('cancelSubmissionEditBtn')?.addEventListener('click', closeSubmissionEditModal);
  document.getElementById('saveSubmissionEditBtn')?.addEventListener('click', saveSubmissionFromModal);
  document.getElementById('exportSubmissionsBtn')?.addEventListener('click', exportSubmissionsCsv);

  const searchInput = document.getElementById('submissionSearchInput');
  if (searchInput) {
    let timer = null;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        submissionSearchQuery = e.target.value;
        renderSubmissionsList();
      }, 200);
    });
  }

  const statusFilter = document.getElementById('submissionStatusFilter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      submissionFilterStatus = e.target.value;
      updateSubmissionStats();
      renderSubmissionsList();
    });
  }

  document.querySelectorAll('.stat-card').forEach((card) => {
    card.addEventListener('click', () => {
      const status = card.getAttribute('data-status') || 'all';
      submissionFilterStatus = status;
      if (statusFilter) {
        statusFilter.value = status;
        if (statusFilter._refreshAppleSelect) statusFilter._refreshAppleSelect();
      }
      updateSubmissionStats();
      renderSubmissionsList();
    });
  });
}

// ============================================================================
// 页面目录侧边栏导航与滚动监听 (Sidebar Nav & Scroll Spy)
// ============================================================================

function initSidebarNav() {
  const links = document.querySelectorAll('.sidebar-link');
  if (!links.length) return;

  // 目录与正文顺序一致，点击后定位到对应资料模块。
  links.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('data-section') || link.getAttribute('href').replace(/^#/, '');
      const targetSection = document.getElementById(targetId);
      if (targetSection) {
        targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, null, '#' + targetId);
        links.forEach((l) => l.classList.remove('active'));
        link.classList.add('active');

      }
    });
  });

  // 滚动监听高亮
  const sections = [...document.querySelectorAll('#view-profile .form-content > .section[id]')];

  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    if (scrollTimer) return;
    scrollTimer = requestAnimationFrame(() => {
      scrollTimer = null;
      const scrollPos = window.scrollY + 120;
      let currentSectionId = '';

      for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        const top = sec.getBoundingClientRect().top + window.scrollY;
        const height = sec.offsetHeight;
        if (scrollPos >= top && scrollPos < top + height) {
          currentSectionId = sec.id;
          break;
        }
      }

      if (!currentSectionId && sections.length > 0) {
        if (scrollPos < sections[0].getBoundingClientRect().top + window.scrollY) {
          currentSectionId = sections[0].id;
        } else {
          currentSectionId = sections[sections.length - 1].id;
        }
      }

      if (currentSectionId) {
        links.forEach((l) => {
          const sec = l.getAttribute('data-section') || l.getAttribute('href').replace(/^#/, '');
          l.classList.toggle('active', sec === currentSectionId);
        });
      }
    });
  }, { passive: true });
}

// ============================================================================
// 顶栏多页面/视图切换管理器 (Apple HIG Segmented Tab Switcher)
// ============================================================================

function initTabNav() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  const views = {
    profile: document.getElementById('view-profile'),
    kanban: document.getElementById('view-kanban'),
    logs: document.getElementById('view-logs'),
    help: document.getElementById('view-help')
  };

  const navProfileGroup = document.getElementById('navProfileGroup');
  const navSaveBtn = document.getElementById('saveBtn');
  const navKanbanActions = document.getElementById('navKanbanActions');
  const sidebarDrawer = document.getElementById('sidebarDrawer');

  function switchTab(tabKey, updateUrl = true) {
    if (!views[tabKey]) tabKey = 'profile';

    tabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabKey);
    });

    Object.entries(views).forEach(([k, viewEl]) => {
      if (!viewEl) return;
      if (k === tabKey) {
        viewEl.style.display = 'block';
        viewEl.classList.add('active');
      } else {
        viewEl.style.display = 'none';
        viewEl.classList.remove('active');
      }
    });

    // 切换顶栏控件和侧边栏
    if (tabKey === 'profile') {
      if (navProfileGroup) navProfileGroup.style.display = 'flex';
      if (navSaveBtn) navSaveBtn.style.display = 'inline-flex';
      if (navKanbanActions) navKanbanActions.style.display = 'none';
      if (sidebarDrawer) sidebarDrawer.style.display = 'block';
    } else if (tabKey === 'kanban') {
      if (navProfileGroup) navProfileGroup.style.display = 'none';
      if (navSaveBtn) navSaveBtn.style.display = 'none';
      if (navKanbanActions) navKanbanActions.style.display = 'flex';
      if (sidebarDrawer) sidebarDrawer.style.display = 'none';
      requestAnimationFrame(() => {
        updateSubmissionStats();
        renderSubmissionsList();
      });
    } else if (tabKey === 'logs') {
      if (navProfileGroup) navProfileGroup.style.display = 'none';
      if (navSaveBtn) navSaveBtn.style.display = 'none';
      if (navKanbanActions) navKanbanActions.style.display = 'none';
      if (sidebarDrawer) sidebarDrawer.style.display = 'none';
      requestAnimationFrame(() => {
        renderLogList();
      });
    } else if (tabKey === 'help') {
      if (navProfileGroup) navProfileGroup.style.display = 'none';
      if (navSaveBtn) navSaveBtn.style.display = 'none';
      if (navKanbanActions) navKanbanActions.style.display = 'none';
      if (sidebarDrawer) sidebarDrawer.style.display = 'none';
    }

    if (updateUrl) {
      history.replaceState(null, null, '#' + tabKey);
    }
    if (window.scrollY > 40) {
      window.scrollTo(0, 0);
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // 顶栏投递看板快捷操作
  document.getElementById('navAddSubmissionBtn')?.addEventListener('click', () => openSubmissionEditModal(null));
  document.getElementById('navExportSubmissionsBtn')?.addEventListener('click', exportSubmissionsCsv);

  // 解析 URL Hash 初始视图
  const rawHash = window.location.hash.replace(/^#/, '');
  if (rawHash === 'kanban' || rawHash === 'submissions' || rawHash === 'section-submissions' || rawHash === 'submissionSection') {
    switchTab('kanban', false);
  } else if (rawHash === 'logs' || rawHash === 'log') {
    switchTab('logs', false);
  } else if (rawHash === 'help' || rawHash === 'faq') {
    switchTab('help', false);
  } else {
    switchTab('profile', false);
    if (rawHash && rawHash !== 'profile') {
      const initialTarget = document.getElementById(rawHash);
      if (initialTarget) {
        setTimeout(() => {
          initialTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 250);
      }
    }
  }

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace(/^#/, '');
    if (h === 'kanban' || h === 'submissions' || h === 'section-submissions' || h === 'submissionSection') {
      switchTab('kanban', false);
    } else if (h === 'logs' || h === 'log') {
      switchTab('logs', false);
    } else if (h === 'help' || h === 'faq') {
      switchTab('help', false);
    } else if (h === 'profile') {
      switchTab('profile', false);
    }
  });
}

function bindAppLogging() {
  if (typeof appLog === 'undefined') return;
  appLog.info('options', 'page.init', '配置页已打开');
  appLog.watchClicks(document);
  document.getElementById('logLevelFilter')?.addEventListener('change', renderLogList);
  document.getElementById('clearLogsBtn')?.addEventListener('click', async () => {
    if (!confirm('确定清空全部运行日志？')) return;
    await appLog.clear();
    renderLogList();
  });
  document.getElementById('exportLogsBtn')?.addEventListener('click', exportLogs);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.jobAutofillLogs) renderLogList(changes.jobAutofillLogs.newValue);
  });
  renderLogList();
}

function logLevelMatch(entry, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'model') return String(entry.event || '').startsWith('model') || String(entry.event || '').startsWith('parse');
  return entry.level === filter;
}

async function renderLogList(preset) {
  const listEl = document.getElementById('logList');
  const emptyEl = document.getElementById('logEmpty');
  if (!listEl) return;
  const logs = Array.isArray(preset) ? preset : (typeof appLog !== 'undefined' ? await appLog.list() : []);
  const filter = document.getElementById('logLevelFilter')?.value || 'all';
  const rows = logs.filter((item) => logLevelMatch(item, filter)).slice().reverse();
  if (!rows.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = rows.map((item) => {
    const time = (item.time || '').replace('T', ' ').replace('Z', '');
    const detail = item.detail
      ? `<pre class="log-detail">${html(String(item.detail))}</pre>`
      : '';
    return `<article class="log-item is-${html(item.level || 'info')}">
      <div class="log-meta">
        <span class="log-time">${html(time)}</span>
        <span class="log-level">${html(item.level || 'info')}</span>
        <span class="log-source">${html(item.source || '')}</span>
        <span class="log-event">${html(item.event || '')}</span>
      </div>
      <div class="log-message">${html(item.message || '')}</div>
      ${detail}
    </article>`;
  }).join('');
}

async function exportLogs() {
  const logs = typeof appLog !== 'undefined' ? await appLog.list() : [];
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `运行日志_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  if (typeof appLog !== 'undefined') appLog.info('options', 'log.export', `已导出 ${logs.length} 条日志`);
}

function appendExtendedFields(root, section, values = {}) {
  const grid = document.createElement('div');
  grid.className = 'form-row form-row-3 extended-fields';
  grid.dataset.fieldSection = section;
  const fieldOrder = {
    basicInfo: ['sourcePlace', 'registeredAddress', 'leagueJoinDate', 'partyJoinDate', 'nationality', 'height', 'weight', 'health'],
    awards: ['issuer', 'rank', 'role', 'url', 'description'],
    jobIntention: ['salaryCurrency', 'salaryUnit', 'salaryPeriod', 'acceptAdjustment', 'acceptCounty'],
    papers: ['name', 'date', 'publisher', 'authorOrder', 'role', 'url', 'abstract'],
    patents: ['name', 'inventor', 'date', 'url', 'description'],
    declarations: ['question', 'answer', 'company', 'hostname', 'explanation']
  };
  const fields = (fieldOrder[section] || Object.keys(profileSchema[section])).map(key => [key, profileSchema[section][key]]);
  for (const [key, label] of fields) {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.dataset.field = key;
    const caption = document.createElement('label');
    caption.textContent = label;
    const yesNo = ['fullTime', 'highestFullTime', 'acceptAdjustment', 'acceptCounty'].includes(key) || (section === 'declarations' && key === 'answer');
    const multiline = !yesNo && (['description', 'abstract', 'answer', 'explanation', 'question'].includes(key) || section === 'commonAnswers');
    const input = document.createElement(yesNo ? 'select' : multiline ? 'textarea' : 'input');
    input.id = `ext-${section}-${key}-${crypto.randomUUID()}`;
    caption.htmlFor = input.id;
    if (multiline) group.classList.add('field-wide');
    if (yesNo) for (const value of ['', '是', '否']) input.add(new Option(value || '未填写', value));
    else if (multiline) input.rows = 3;
    else input.type = 'text';
    input.dataset.extKey = key;
    setFieldValue(input, Array.isArray(values[key]) ? values[key].join('\n') : values[key]);
    if (/date$/i.test(key)) input.placeholder = 'YYYY-MM 或 YYYY-MM-DD';
    if (section === 'declarations' && key === 'question') input.placeholder = '例如：是否有亲属在本公司任职或退休？';
    if (key === 'hostname') input.placeholder = '例如：job.xiaohongshu.com';
    group.append(caption, input);
    grid.append(group);
  }
  if (section === 'basicInfo' && values.politicalJoinDate) {
    const legacy = document.createElement('p');
    legacy.className = 'legacy-political-date';
    legacy.textContent = `旧入党团时间：${values.politicalJoinDate}。请核对后分别填写入团时间或入党时间，旧记录仍保留。`;
    grid.append(legacy);
  }
  root.append(grid);
  initAllAppleSelects(grid);
}

function readExtendedFields(root) {
  return Object.fromEntries([...root.querySelectorAll('[data-ext-key]')].map(input => [input.dataset.extKey,
    input.dataset.extKey === 'programmingLanguages' ? input.value.split('\n').map(s => s.trim()).filter(Boolean) : input.value.trim()]));
}

function renderExtendedList(section, root, entries) {
  root.replaceChildren();
  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.entryId = entry.id;
    appendExtendedFields(card, section, entry);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-delete';
    remove.textContent = '删除条目';
    remove.onclick = () => { card.remove(); debouncedSave(); };
    card.append(remove);
    root.append(card);
  }
}

// 标题和目录共用线性图标，避免依赖系统 Emoji 字形。
function profileIcon(key) {
  const paths = {
    ai: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 9h6v6H9zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
    parser: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8m-8 4h5"/>',
    basic: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    intention: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    education: '<path d="m2 9 10-5 10 5-10 5zM6 11v6c4 3 8 3 12 0v-6m4-2v7"/>',
    work: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12a20 20 0 0 0 18 0M12 11v4"/>',
    projects: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 4h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    awards: '<path d="M8 3h8v7a4 4 0 0 1-8 0zM8 5H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4M12 14v7m-4 0h8"/>',
    certificates: '<circle cx="12" cy="8" r="5"/><path d="m8 12-2 9 6-3 6 3-2-9"/>',
    papers: '<path d="M4 3h12a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2zm0 14h14M8 7h6m-6 4h6"/>',
    patents: '<path d="M9 18h6m-6 3h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4"/>',
    openSource: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    skills: '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
    commonAnswers: '<path d="M21 15a3 3 0 0 1-3 3H8l-5 4V5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3zM7 7h10M7 12h7"/>',
    customAnswers: '<path d="M21 15a3 3 0 0 1-3 3H8l-5 4V5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3zM9 7a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
    family: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 3a4 4 0 0 1 0 8m2 4a6 6 0 0 1 3 6"/>',
    declarations: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6"/>',
    actions: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2M7 3v6h10V3M7 21v-8h10v8"/>',
    address: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    language: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]}</svg>`;
}

// 页面顺序和目录共用同一份定义，动态新增模块不会落到操作栏之后。
function arrangeProfileSections() {
  const order = [
    ['ai', 'AI 模型配置'], ['parser', '简历解析与附件'],
    ['basic', '基础个人信息'], ['intention', '求职意向与语言'],
    ['education', '教育经历'], ['work', '工作 / 实习经历'], ['projects', '项目经历'],
    ['awards', '荣誉奖项'], ['certificates', '资格证书'],
    ['papers', '论文'], ['patents', '专利'], ['openSource', '开源成果'],
    ['skills', '技能与自我介绍'], ['commonAnswers', '常用问答'], ['customAnswers', '额外问题与答案'],
    ['family', '家庭成员'], ['declarations', '个人声明'], ['actions', '保存 / 删除资料']
  ];
  document.querySelectorAll('#view-profile [data-heading-icon]').forEach(heading => {
    heading.querySelector('.heading-icon')?.remove();
    const icon = document.createElement('span');
    icon.className = 'heading-icon';
    icon.innerHTML = profileIcon(heading.dataset.headingIcon);
    heading.prepend(icon);
  });
  const content = document.querySelector('#view-profile .form-content');
  const menu = document.querySelector('.sidebar-menu');
  for (const [key, title] of order) {
    const id = `section-${key}`;
    const section = document.getElementById(id);
    content.append(section);
    const heading = section.querySelector('.section-title');
    if (heading) {
      let icon = section.querySelector('.section-icon');
      if (!icon) {
        icon = document.createElement('span');
        icon.className = 'section-icon';
        heading.prepend(icon);
      }
      icon.innerHTML = profileIcon(key);
    }
    let link = menu.querySelector(`[data-section="${id}"]`);
    if (!link) {
      link = document.createElement('a');
      link.className = 'sidebar-link';
      link.href = `#${id}`;
      link.dataset.section = id;
      const icon = document.createElement('span');
      icon.className = 'nav-icon'; icon.textContent = '·'; icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span'); text.className = 'nav-text'; text.textContent = title;
      link.append(icon, text);
    }
    link.querySelector('.nav-icon').innerHTML = profileIcon(key);
    menu.append(link);
  }
}

function renderExtendedProfile(profile) {
  const basic = document.getElementById('section-basic');
  for (const [section, target] of [['basicInfo', 'section-basic'], ['jobIntention', 'section-intention']]) {
    const root = document.getElementById(target);
    root.querySelector('.extended-fields')?.remove();
    appendExtendedFields(root, section, profile[section]);
  }
  for (const [section, title] of Object.entries({ papers: '论文', patents: '专利', openSource: '开源成果', commonAnswers: '常用问答', customAnswers: '额外问题与答案', declarations: '个人声明' })) {
    let panel = document.getElementById(`section-${section}`);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = `section-${section}`;
      panel.className = 'section glass';
      const heading = document.createElement('h2');
      heading.className = 'section-title';
      heading.textContent = title;
      panel.append(heading);
      basic.parentElement.append(panel);
    }
    while (panel.children.length > 1) panel.lastElementChild.remove();
    if (section === 'declarations') {
      const note = document.createElement('p');
      note.textContent = '亲属任职或退休、境外身份、违法违纪等按原题逐项保存。未填写不代表否。自动填写需匹配企业和域名，并每次确认；承诺、签名请本人操作。';
      panel.append(note);
    }
    if (section === 'commonAnswers') appendExtendedFields(panel, section, profile[section]);
    else {
      const list = document.createElement('div');
      list.dataset.extList = section;
      renderExtendedList(section, list, profile[section] || []);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn-add-item btn-add-entry';
      add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
      const addLabel = document.createElement('span');
      addLabel.textContent = `添加${title === '额外问题与答案' ? '问答' : title}`;
      add.append(addLabel);
      add.onclick = () => {
        const entries = [...list.children].map(card => ({ id: card.dataset.entryId, ...readExtendedFields(card) }));
        entries.push({ id: generateId() });
        renderExtendedList(section, list, entries);
        debouncedSave();
      };
      panel.append(list, add);
    }
  }
  arrangeProfileSections();
  for (const input of basic.parentElement.querySelectorAll('input[class*="-start"],input[class*="-end"],input[class*="-date"],input[class*="-expiry"],#graduationDate')) {
    input.placeholder = 'YYYY-MM 或 YYYY-MM-DD（结束时间也可填至今）';
  }
  renderAttachmentPanel();
}

function collectExtendedProfile(updates) {
  for (const [section, target] of [['basicInfo', 'section-basic'], ['jobIntention', 'section-intention'], ['commonAnswers', 'section-commonAnswers']]) {
    const root = document.getElementById(target);
    if (root) updates[section] = { ...updates[section], ...readExtendedFields(root) };
  }
  for (const [section, target] of [['education', 'educationList'], ['projects', 'projectList'], ['awards', 'awardsList'], ['familyMembers', 'familyList']]) {
    document.querySelectorAll(`#${target} .item-card`).forEach((card, index) => Object.assign(updates[section][index], readExtendedFields(card)));
  }
  for (const list of document.querySelectorAll('[data-ext-list]')) {
    updates[list.dataset.extList] = [...list.children].map(card => ({ id: card.dataset.entryId, ...readExtendedFields(card) }));
  }
  return updates;
}

async function changeAttachment(action, kind, extra) {
  const profileId = extra.profileId || activeProfileId;
  const response = await sendMessage({ action, profileId, kind, ...extra });
  if (!response.success) throw new Error(response.error || '附件保存失败');
  if (profileId === activeProfileId) {
    currentProfile.attachments = response.attachments;
    if (kind === 'resume') { currentProfile.resumeFile = null; currentProfile.resumeFileName = ''; }
    renderAttachmentPanel();
    updateResumeAttachmentUI(currentProfile.attachments.resume?.name || '', currentProfile.attachments.resume?.size || 0);
  }
}

async function saveAttachmentFile(kind, file, replaceId) {
  const profileId = activeProfileId;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
  await changeAttachment('saveAttachment', kind, { profileId, file: { name: file.name, size: file.size, type: file.type, dataUrl }, replaceId });
}

function renderAttachmentPanel() {
  let root = document.getElementById('attachmentPanel');
  if (!root) {
    root = document.createElement('div'); root.id = 'attachmentPanel';
    document.getElementById('section-parser').append(root);
  }
  root.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'attachment-panel-title'; heading.textContent = '附件管理';
  const grid = document.createElement('div'); grid.className = 'attachment-grid';
  root.append(heading, grid);
  for (const [kind, title] of Object.entries({ resume: '简历', idPhoto: '证件照', lifePhoto: '生活照', works: '作品附件' })) {
    const group = document.createElement('section'); group.className = 'attachment-card';
    const header = document.createElement('div'); header.className = 'attachment-card-header';
    const label = document.createElement('h4'); label.textContent = title;
    const hint = document.createElement('span'); hint.className = 'attachment-kind-hint';
    hint.textContent = kind === 'works' ? '支持多个文件' : /Photo$/.test(kind) ? '图片 · 保存一份' : '保存一份';
    header.append(label, hint); group.append(header);
    const input = document.createElement('input'); input.type = 'file'; input.multiple = kind === 'works';
    input.hidden = true; input.setAttribute('aria-label', `上传${title}`);
    if (/Photo$/.test(kind)) input.accept = 'image/*';
    input.onchange = async () => {
      try { for (const file of input.files) await saveAttachmentFile(kind, file); }
      catch (error) { showToast(error.message, 'error'); }
    };
    group.append(input);
    const files = kind === 'works' ? currentProfile.attachments?.works || [] : [currentProfile.attachments?.[kind]].filter(Boolean);
    if (!files.length) {
      const empty = document.createElement('p'); empty.className = 'attachment-empty';
      empty.textContent = `尚未上传${title}`; group.append(empty);
    }
    for (const file of files) {
      const row = document.createElement('div'); row.className = 'attachment-file';
      const meta = document.createElement('div'); meta.className = 'attachment-file-meta';
      const name = document.createElement('span'); name.className = 'attachment-file-name'; name.textContent = file.name;
      const size = document.createElement('span'); size.className = 'attachment-file-size'; size.textContent = formatAiFileSize(file.size);
      meta.append(name, size); row.append(meta);
      const actions = document.createElement('div'); actions.className = 'attachment-file-actions';
      for (const [action, title] of [['download', '下载'], ['replace', '替换'], ['delete', '删除']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = title;
        button.className = `attachment-action${action === 'delete' ? ' is-danger' : ''}`;
        button.setAttribute('aria-label', `${title} ${file.name}`);
        button.onclick = async () => {
          try {
            if (action === 'delete') await changeAttachment('deleteAttachment', kind, { id: file.id });
            else if (action === 'replace') {
              const picker = document.createElement('input'); picker.type = 'file'; picker.accept = input.accept;
              picker.onchange = () => picker.files[0] && saveAttachmentFile(kind, picker.files[0], file.id).catch(error => showToast(error.message, 'error'));
              picker.click();
            } else {
              const response = await sendMessage({ action: 'getAttachment', profileId: activeProfileId, id: file.id });
              if (!response.success) throw new Error(response.error);
              const link = document.createElement('a'); link.href = response.file.dataUrl; link.download = file.name; link.click();
            }
          } catch (error) { showToast(error.message, 'error'); }
        };
        actions.append(button);
      }
      row.append(actions); group.append(row);
    }
    if (!files.length || kind === 'works') {
      const upload = document.createElement('button'); upload.type = 'button';
      upload.className = 'btn-add-item attachment-upload';
      upload.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>';
      upload.append(document.createTextNode(`上传${title}`));
      upload.onclick = () => input.click(); group.append(upload);
    }
    grid.append(group);
  }
  sendMessage({ action: 'getStorageInfo' }).then(response => {
    if (!response.success || !root.isConnected) return;
    const info = document.createElement('p'); info.className = 'attachment-storage-info';
    info.textContent = `资料与附件实际占用 ${response.info.sizeInMB} MB（附件 ${formatAiFileSize(response.info.attachmentBytes)}）；可用配额由当前浏览器管理。`;
    root.append(info);
  }).catch(console.warn);
}
