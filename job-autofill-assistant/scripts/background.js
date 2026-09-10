// ============================================================================
// Background Service Worker
// 处理跨页面消息和数据管理
// ============================================================================

// 导入storage manager（在service worker中需要用importScripts）
importScripts('profile-schema.js', 'attachments.js', 'storage.js', 'resume-parser.js', 'app-log.js');

console.log('[秋招助手] Background Service Worker 已启动');
if (typeof appLog !== 'undefined') appLog.info('background', 'sw.start', '后台服务已启动');

// 初始化存储
const storageReady = storageManager.initialize();
storageReady.then(() => {
  console.log('[秋招助手] 存储初始化完成');
});

// 监听消息
let dataMessageQueue = Promise.resolve();
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (['aiGenerate', 'parseResume'].includes(request.action)) return dispatchMessage(request, sender, sendResponse);
  dataMessageQueue = dataMessageQueue.catch(() => {}).then(() => storageReady).then(() => new Promise(resolve => {
    dispatchMessage(request, sender, response => { sendResponse(response); resolve(); });
  }));
  dataMessageQueue.catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});

function dispatchMessage(request, sender, sendResponse) {
  console.log('[秋招助手] 收到消息:', request.action);

  switch (request.action) {
    case 'saveAttachment':
    case 'getAttachment':
    case 'deleteAttachment':
    case 'getStorageInfo':
      handleAttachmentMessage(request).then(result => sendResponse({ success: true, ...result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'getActiveProfile':
      handleGetActiveProfile(sendResponse);
      return true; // 异步响应

    case 'getAllProfiles':
      handleGetAllProfiles(sendResponse);
      return true;

    case 'addProfile':
      handleAddProfile(request.name, sendResponse);
      return true;

    case 'updateProfile':
      handleUpdateProfile(request.profileId, request.updates, sendResponse);
      return true;

    case 'deleteProfile':
      handleDeleteProfile(request.profileId, sendResponse);
      return true;

    case 'setActiveProfile':
      handleSetActiveProfile(request.profileId, sendResponse);
      return true;

    case 'getSettings':
      handleGetSettings(sendResponse);
      return true;

    case 'updateSettings':
      handleUpdateSettings(request.settings, sendResponse);
      return true;

    case 'addEducation':
      handleAddEducation(request.profileId, sendResponse);
      return true;

    case 'deleteEducation':
      handleDeleteEducation(request.profileId, request.eduId, sendResponse);
      return true;

    case 'addWorkExperience':
      handleAddWorkExperience(request.profileId, sendResponse);
      return true;

    case 'deleteWorkExperience':
      handleDeleteWorkExperience(request.profileId, request.workId, sendResponse);
      return true;

    case 'addProject':
      handleAddProject(request.profileId, sendResponse);
      return true;

    case 'deleteProject':
      handleDeleteProject(request.profileId, request.projectId, sendResponse);
      return true;

    case 'exportData':
      handleExportData(sendResponse);
      return true;

    case 'importData':
      handleImportData(request.data, sendResponse);
      return true;

    case 'parseResume':
      handleParseResume(request.fileData, request.fileName, sendResponse);
      return true;

    case 'getSubmissions':
      handleGetSubmissions(sendResponse);
      return true;

    case 'addSubmission':
    case 'recordSubmission':
      handleAddSubmission(request.data, sendResponse);
      return true;

    case 'updateSubmission':
      handleUpdateSubmission(request.id, request.updates, sendResponse);
      return true;

    case 'deleteSubmission':
      handleDeleteSubmission(request.id, sendResponse);
      return true;

    case 'appendLog':
      persistLogEntries([request.entry]).then(() => sendResponse({ success: true }));
      return true;

    case 'openOptions':
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
      return true;

    case 'aiGenerate':
      handleAiGenerate(request.prompt, request.systemPrompt, sendResponse, request.maxTokens);
      return true;

    case 'appendLogs':
      persistLogEntries(request.entries || []).then(() => sendResponse({ success: true }));
      return true;

    case 'getLogs':
      chrome.storage.local.get(APP_LOG_KEY, (res) => {
        sendResponse({ success: true, logs: res && res[APP_LOG_KEY] ? res[APP_LOG_KEY] : [] });
      });
      return true;

    case 'clearLogs':
      chrome.storage.local.set({ [APP_LOG_KEY]: [] }, () => sendResponse({ success: true }));
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
}

// ============================================================================
// 消息处理函数
// ============================================================================

async function handleAiGenerate(prompt, systemPrompt, sendResponse, maxTokens) {
  try {
    const settings = await storageManager.getSettings();
    if (!settings.aiEnabled || !settings.aiApiKey) {
      sendResponse({
        success: false,
        error: 'AI_NOT_CONFIGURED',
        message: '请先在插件设置中启用 AI 并配置 API Key'
      });
      return;
    }
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
    const reply = await resumeParser.chat(settings, messages, {
      temperature: 0.3,
      maxTokens: Math.min(Number(maxTokens) || 400, 800),
      enableThinking: false
    });
    sendResponse({ success: true, text: reply });
  } catch (error) {
    sendResponse({
      success: false,
      error: error.message || 'AI 生成失败'
    });
  }
}

async function handleGetActiveProfile(sendResponse) {
  try {
    const profile = await storageManager.getActiveProfile();
    sendResponse({ success: true, profile });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleGetAllProfiles(sendResponse) {
  try {
    const profiles = await storageManager.getAllProfiles();
    const data = await storageManager.loadAll();
    sendResponse({
      success: true,
      profiles,
      activeProfileId: data.activeProfileId
    });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleAddProfile(name, sendResponse) {
  try {
    const profileId = await storageManager.addProfile(name);
    sendResponse({ success: true, profileId });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleUpdateProfile(profileId, updates, sendResponse) {
  try {
    await storageManager.updateProfile(profileId, updates);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleDeleteProfile(profileId, sendResponse) {
  try {
    const result = await storageManager.deleteProfile(profileId);
    sendResponse({ success: result });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleSetActiveProfile(profileId, sendResponse) {
  try {
    await storageManager.setActiveProfile(profileId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleGetSettings(sendResponse) {
  try {
    const settings = await storageManager.getSettings();
    sendResponse({ success: true, settings });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleUpdateSettings(settings, sendResponse) {
  try {
    await storageManager.updateSettings(settings);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleAddEducation(profileId, sendResponse) {
  try {
    await storageManager.addEducation(profileId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleDeleteEducation(profileId, eduId, sendResponse) {
  try {
    await storageManager.deleteEducation(profileId, eduId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleAddWorkExperience(profileId, sendResponse) {
  try {
    await storageManager.addWorkExperience(profileId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleDeleteWorkExperience(profileId, workId, sendResponse) {
  try {
    await storageManager.deleteWorkExperience(profileId, workId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleAddProject(profileId, sendResponse) {
  try {
    await storageManager.addProject(profileId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleDeleteProject(profileId, projectId, sendResponse) {
  try {
    await storageManager.deleteProject(profileId, projectId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleExportData(sendResponse) {
  try {
    const data = await storageManager.exportData();
    sendResponse({ success: true, data });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleImportData(data, sendResponse) {
  try {
    await storageManager.importData(data);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// AI简历解析
async function handleParseResume(fileData, fileName, sendResponse) {
  try {
    console.log('[简历解析] 开始解析:', fileName);

    // 获取AI设置
    const settings = await storageManager.getSettings();

    if (!settings.aiEnabled || !settings.aiApiKey) {
      sendResponse({
        success: false,
        error: 'AI_NOT_CONFIGURED',
        message: '请先在设置中配置AI API Key'
      });
      return;
    }

    // 将base64转换为Blob
    const response = await fetch(fileData);
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: blob.type });

    // 优先让模型读取原始文件；接口不支持时由解析器自动提取文字重试
    try {
      const result = await resumeParser.parseFileWithAI(file, settings);
      console.log('[简历解析] AI解析成功，输入模式:', result.inputMode);

      sendResponse({
        success: true,
        data: result.data,
        inputMode: result.inputMode,
        extractionMode: result.extractionMode || ''
      });
    } catch (error) {
      console.error('[简历解析] AI解析失败:', error);
      sendResponse({
        success: false,
        error: 'AI_PARSE_FAILED',
        message: error.message || 'AI解析失败，请重试'
      });
    }
  } catch (e) {
    console.error('[简历解析] 未知错误:', e);
    sendResponse({
      success: false,
      error: 'UNKNOWN_ERROR',
      message: e.message || '解析失败'
    });
  }
}

// ============================================================================
// 投递历史处理函数
// ============================================================================

async function handleGetSubmissions(sendResponse) {
  try {
    const list = await storageManager.getSubmissions();
    sendResponse({ success: true, submissions: list });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleAddSubmission(data, sendResponse) {
  try {
    const record = await storageManager.addSubmission(data);
    sendResponse({ success: true, record });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleUpdateSubmission(id, updates, sendResponse) {
  try {
    const ok = await storageManager.updateSubmission(id, updates);
    sendResponse({ success: ok });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleDeleteSubmission(id, sendResponse) {
  try {
    const ok = await storageManager.deleteSubmission(id);
    sendResponse({ success: ok });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// 监听扩展安装/更新
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[秋招助手] 首次安装');
    // 打开欢迎页面（可选）
    // chrome.tabs.create({ url: 'welcome.html' });
  } else if (details.reason === 'update') {
    console.log('[秋招助手] 更新到版本:', chrome.runtime.getManifest().version);
  }
});

async function handleAttachmentMessage(request) {
  await storageReady;
  if (request.action === 'getStorageInfo') return { info: await storageManager.getStorageInfo() };
  if (request.action === 'getAttachment') return { file: await storageManager.getAttachment(request.profileId, request.id) };
  const attachments = request.action === 'saveAttachment'
    ? await storageManager.saveAttachment(request.profileId, request.kind, request.file, request.replaceId)
    : await storageManager.deleteAttachment(request.profileId, request.kind, request.id);
  return { attachments };
}
