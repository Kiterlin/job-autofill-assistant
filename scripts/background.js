// ============================================================================
// Background Service Worker
// 处理跨页面消息和数据管理
// ============================================================================

// 导入storage manager（在service worker中需要用importScripts）
importScripts('storage.js', 'resume-parser.js');

console.log('[秋招助手] Background Service Worker 已启动');

// 初始化存储
storageManager.initialize().then(() => {
  console.log('[秋招助手] 存储初始化完成');
});

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[秋招助手] 收到消息:', request.action);

  switch (request.action) {
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

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

// ============================================================================
// 消息处理函数
// ============================================================================

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

    // 提取文本
    let resumeText;
    try {
      resumeText = await resumeParser.extractText(file);
      console.log('[简历解析] 文本提取成功，长度:', resumeText.length);
    } catch (error) {
      console.error('[简历解析] 文本提取失败:', error);
      sendResponse({
        success: false,
        error: 'EXTRACT_FAILED',
        message: '简历文本提取失败，请确保文件格式正确'
      });
      return;
    }

    // 使用AI解析
    try {
      const parsedData = await resumeParser.parseWithAI(resumeText, settings);
      console.log('[简历解析] AI解析成功');

      sendResponse({
        success: true,
        data: parsedData
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
