// ============================================================================
// 运行日志：记录点击、模型调用、解析过程
// 独立存在 chrome.storage.local.jobAutofillLogs，不写入简历资料
// ============================================================================

const APP_LOG_KEY = 'jobAutofillLogs';
const APP_LOG_MAX = 1000;

function appLogRedact(value) {
  if (value == null) return '';
  let text = typeof value === 'string' ? value : '';
  try {
    if (typeof value !== 'string') text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text
    .replace(/sk-[A-Za-z0-9_\-]{6,}/g, 'sk-***')
    .replace(/AIza[A-Za-z0-9_\-]{6,}/g, 'AIza***')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/key=[^&]+/gi, 'key=***')
    .slice(0, 4000);
}

function appLogSafeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('key');
    return parsed.origin + parsed.pathname;
  } catch {
    return appLogRedact(url);
  }
}

function appLogInServiceWorker() {
  return typeof importScripts === 'function' && typeof window === 'undefined';
}

const appLogState = {
  queue: [],
  timer: null,
  listeners: []
};

function appLogFlush() {
  appLogState.timer = null;
  const batch = appLogState.queue.splice(0, appLogState.queue.length);
  if (!batch.length) return;

  const write = (existing) => {
    const merged = (Array.isArray(existing) ? existing : []).concat(batch);
    const trimmed = merged.length > APP_LOG_MAX ? merged.slice(merged.length - APP_LOG_MAX) : merged;
    chrome.storage.local.set({ [APP_LOG_KEY]: trimmed });
  };

  if (appLogInServiceWorker() || !chrome.runtime?.sendMessage) {
    chrome.storage.local.get(APP_LOG_KEY, (res) => write(res && res[APP_LOG_KEY]));
    return;
  }

  try {
    chrome.runtime.sendMessage({ action: 'appendLogs', entries: batch }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    chrome.storage.local.get(APP_LOG_KEY, (res) => write(res && res[APP_LOG_KEY]));
  }
}

const appLog = {
  append(entry) {
    const item = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      time: new Date().toISOString(),
      level: entry.level || 'info',
      source: entry.source || 'app',
      event: entry.event || 'note',
      message: appLogRedact(entry.message || ''),
      detail: entry.detail ? appLogRedact(entry.detail) : ''
    };
    appLogState.queue.push(item);
    const prefix = `[日志][${item.level}][${item.source}]`;
    if (item.level === 'error') console.error(prefix, item.message, item.detail || '');
    else if (item.level === 'warn') console.warn(prefix, item.message, item.detail || '');
    else console.log(prefix, item.message, item.detail || '');
    if (item.level === 'error') {
      appLogFlush();
      return;
    }
    if (!appLogState.timer) {
      appLogState.timer = setTimeout(appLogFlush, 180);
    }
  },

  info(source, event, message, detail) {
    this.append({ level: 'info', source, event, message, detail });
  },
  success(source, event, message, detail) {
    this.append({ level: 'success', source, event, message, detail });
  },
  warn(source, event, message, detail) {
    this.append({ level: 'warn', source, event, message, detail });
  },
  error(source, event, message, detail) {
    this.append({ level: 'error', source, event, message, detail });
  },
  click(source, event, message, detail) {
    this.append({ level: 'click', source, event, message, detail });
  },
  model(source, event, message, detail, ok) {
    this.append({
      level: ok ? 'success' : 'error',
      source,
      event,
      message,
      detail
    });
  },

  watchClicks(root) {
    if (!root || root.__appLogClicks) return;
    root.__appLogClicks = true;
    root.addEventListener('click', (event) => {
      const target = event.target && event.target.closest
        ? event.target.closest('button, a, [data-log], .nav-tab-btn, .icon-btn, .btn-primary, .btn-secondary')
        : null;
      if (!target) return;
      if (target.closest && target.closest('#logList')) return;
      const label = (target.innerText || target.textContent || target.title || target.id || '未命名')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      this.click('ui', 'ui.click', label, {
        id: target.id || '',
        tag: target.tagName
      });
    }, true);
  },

  async list() {
    return new Promise((resolve) => {
      chrome.storage.local.get(APP_LOG_KEY, (res) => {
        resolve(Array.isArray(res && res[APP_LOG_KEY]) ? res[APP_LOG_KEY] : []);
      });
    });
  },

  async clear() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [APP_LOG_KEY]: [] }, () => resolve());
    });
  }
};

async function persistLogEntries(entries) {
  const batch = Array.isArray(entries) ? entries : [entries];
  return new Promise((resolve) => {
    chrome.storage.local.get(APP_LOG_KEY, (res) => {
      const existing = Array.isArray(res && res[APP_LOG_KEY]) ? res[APP_LOG_KEY] : [];
      const merged = existing.concat(batch);
      const trimmed = merged.length > APP_LOG_MAX ? merged.slice(merged.length - APP_LOG_MAX) : merged;
      chrome.storage.local.set({ [APP_LOG_KEY]: trimmed }, () => resolve(true));
    });
  });
}
