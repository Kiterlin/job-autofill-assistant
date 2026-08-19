// ============================================================================
// Options 页面脚本 - 配置界面
// ============================================================================

let currentProfile = null;
let allProfiles = [];
let activeProfileId = null;

// ============================================================================
// 初始化
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Options] 初始化');
  await loadProfiles();
  bindEvents();
});

// ============================================================================
// 数据加载（复用popup.js的逻辑）
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
        if (currentProfile) {
          loadProfileToForm(currentProfile);
        }

        // 加载AI设置
        loadAISettings();
      }
      resolve();
    });
  });
}

// 加载AI设置
function loadAISettings() {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (response && response.success) {
      const settings = response.settings;
      document.getElementById('aiEnabled').checked = settings.aiEnabled || false;
      document.getElementById('aiProvider').value = settings.aiProvider || 'deepseek';
      document.getElementById('aiApiKey').value = settings.aiApiKey || '';
      document.getElementById('aiApiUrl').value = settings.aiApiUrl || '';

      // 显示/隐藏AI设置
      document.getElementById('aiSettings').style.display = settings.aiEnabled ? 'block' : 'none';
    }
  });
}

// 加载资料到表单
function loadProfileToForm(profile) {
  // 基础信息
  document.getElementById('fullName').value = profile.basicInfo.fullName || '';
  document.getElementById('firstName').value = profile.basicInfo.firstName || '';
  document.getElementById('lastName').value = profile.basicInfo.lastName || '';
  document.getElementById('phone').value = profile.basicInfo.phone || '';
  document.getElementById('email').value = profile.basicInfo.email || '';
  document.getElementById('gender').value = profile.basicInfo.gender || '';
  document.getElementById('birthDate').value = profile.basicInfo.birthDate || '';
  document.getElementById('idCard').value = profile.basicInfo.idCard || '';

  // 地址信息
  document.getElementById('city').value = profile.basicInfo.city || '';
  document.getElementById('state').value = profile.basicInfo.state || '';
  document.getElementById('country').value = profile.basicInfo.country || '';
  document.getElementById('zipCode').value = profile.basicInfo.zipCode || '';
  document.getElementById('street').value = profile.basicInfo.street || '';

  // 社交链接
  document.getElementById('linkedin').value = profile.basicInfo.linkedin || '';
  document.getElementById('github').value = profile.basicInfo.github || '';
  document.getElementById('website').value = profile.basicInfo.website || '';
  document.getElementById('twitter').value = profile.basicInfo.twitter || '';

  // 教育经历
  renderEducationList(profile.education);

  // 工作经历
  renderWorkList(profile.workExperience);

  // 项目经历
  renderProjectList(profile.projects);

  // 技能
  renderSkillsList(profile.skills);

  // 自我介绍
  document.getElementById('introduction').value = profile.introTemplates?.default || '';

  // 简历文件
  if (profile.resumeFileName) {
    document.getElementById('resumeFileName').textContent = profile.resumeFileName;
  }
}

// 渲染教育经历（简化版）
function renderEducationList(educationList) {
  const container = document.getElementById('educationList');
  container.innerHTML = '';

  educationList.forEach((edu, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4>教育经历 ${index + 1}</h4>
        <button class="btn-delete" data-id="${edu.id}" data-type="education">删除</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>学校名称</label>
          <input type="text" class="edu-school" data-id="${edu.id}" value="${edu.school || ''}" placeholder="北京大学">
        </div>
        <div class="form-group">
          <label>专业</label>
          <input type="text" class="edu-major" data-id="${edu.id}" value="${edu.major || ''}" placeholder="计算机科学">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>学历</label>
          <select class="edu-degree" data-id="${edu.id}">
            <option value="">请选择</option>
            <option value="大专" ${edu.degree === '大专' ? 'selected' : ''}>大专</option>
            <option value="本科" ${edu.degree === '本科' ? 'selected' : ''}>本科</option>
            <option value="硕士" ${edu.degree === '硕士' ? 'selected' : ''}>硕士</option>
            <option value="博士" ${edu.degree === '博士' ? 'selected' : ''}>博士</option>
          </select>
        </div>
        <div class="form-group">
          <label>GPA</label>
          <input type="text" class="edu-gpa" data-id="${edu.id}" value="${edu.gpa || ''}" placeholder="3.8/4.0">
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // 绑定删除事件
  container.querySelectorAll('.btn-delete[data-type="education"]').forEach(btn => {
    btn.addEventListener('click', (e) => deleteEducation(e.target.getAttribute('data-id')));
  });
}

// 渲染工作经历（简化版）
function renderWorkList(workList) {
  const container = document.getElementById('workList');
  container.innerHTML = '';

  workList.forEach((work, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4>工作经历 ${index + 1}</h4>
        <button class="btn-delete" data-id="${work.id}" data-type="work">删除</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>公司名称</label>
          <input type="text" class="work-company" data-id="${work.id}" value="${work.company || ''}" placeholder="字节跳动">
        </div>
        <div class="form-group">
          <label>职位</label>
          <input type="text" class="work-position" data-id="${work.id}" value="${work.position || ''}" placeholder="前端开发">
        </div>
      </div>
      <div class="form-group">
        <label>工作描述</label>
        <textarea class="work-desc" data-id="${work.id}" rows="2">${work.description || ''}</textarea>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="work"]').forEach(btn => {
    btn.addEventListener('click', (e) => deleteWorkExperience(e.target.getAttribute('data-id')));
  });
}

// 渲染项目经历（简化版）
function renderProjectList(projectList) {
  const container = document.getElementById('projectList');
  container.innerHTML = '';

  projectList.forEach((project, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4>项目 ${index + 1}</h4>
        <button class="btn-delete" data-id="${project.id}" data-type="project">删除</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>项目名称</label>
          <input type="text" class="proj-name" data-id="${project.id}" value="${project.name || ''}" placeholder="在线商城">
        </div>
        <div class="form-group">
          <label>担任角色</label>
          <input type="text" class="proj-role" data-id="${project.id}" value="${project.role || ''}" placeholder="前端负责人">
        </div>
      </div>
      <div class="form-group">
        <label>项目描述</label>
        <textarea class="proj-desc" data-id="${project.id}" rows="2">${project.description || ''}</textarea>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="project"]').forEach(btn => {
    btn.addEventListener('click', (e) => deleteProject(e.target.getAttribute('data-id')));
  });
}

// 渲染技能列表
function renderSkillsList(skills) {
  const container = document.getElementById('skillsList');
  container.innerHTML = '';

  skills.forEach(skill => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `${skill}<span class="tag-remove" data-skill="${skill}">×</span>`;
    container.appendChild(tag);
  });

  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => removeSkill(e.target.getAttribute('data-skill')));
  });
}

// ============================================================================
// 事件绑定
// ============================================================================

function bindEvents() {
  // 资料切换
  document.getElementById('profileSelect').addEventListener('change', async (e) => {
    const profileId = e.target.value;
    await switchProfile(profileId);
  });

  // 新增资料
  document.getElementById('addProfileBtn').addEventListener('click', addNewProfile);

  // 保存按钮（两个）
  document.getElementById('saveBtn').addEventListener('click', saveProfile);
  document.getElementById('saveBtn2').addEventListener('click', saveProfile);

  // 删除资料
  document.getElementById('deleteProfileBtn').addEventListener('click', deleteCurrentProfile);

  // 添加教育/工作/项目
  document.getElementById('addEducationBtn').addEventListener('click', () => addEducation());
  document.getElementById('addWorkBtn').addEventListener('click', () => addWorkExperience());
  document.getElementById('addProjectBtn').addEventListener('click', () => addProject());

  // 技能输入
  document.getElementById('skillInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkill();
    }
  });

  // 模板按钮
  document.querySelectorAll('.btn-template').forEach(btn => {
    btn.addEventListener('click', (e) => loadIntroductionTemplate(e.target.getAttribute('data-template')));
  });

  // 简历上传
  document.getElementById('uploadResumeBtn').addEventListener('click', () => {
    document.getElementById('resumeFile').click();
  });

  document.getElementById('resumeFile').addEventListener('change', handleResumeUpload);

  // AI解析简历文本
  document.getElementById('parseTextBtn').addEventListener('click', parseResumeText);

  // AI设置切换
  document.getElementById('aiEnabled').addEventListener('change', (e) => {
    document.getElementById('aiSettings').style.display = e.target.checked ? 'block' : 'none';
    // 自动保存AI设置
    autoSaveAiSettings();
  });

  // AI提供商变更时自动保存
  document.getElementById('aiProvider').addEventListener('change', autoSaveAiSettings);

  // API Key变更时自动保存（延迟保存，避免频繁IO）
  let aiKeySaveTimer = null;
  document.getElementById('aiApiKey').addEventListener('input', () => {
    clearTimeout(aiKeySaveTimer);
    aiKeySaveTimer = setTimeout(autoSaveAiSettings, 1000); // 1秒后保存
  });

  // API URL变更时自动保存
  let aiUrlSaveTimer = null;
  document.getElementById('aiApiUrl').addEventListener('input', () => {
    clearTimeout(aiUrlSaveTimer);
    aiUrlSaveTimer = setTimeout(autoSaveAiSettings, 1000);
  });

  // 测试AI连接
  document.getElementById('testAiBtn').addEventListener('click', testAiConnection);
}

// ============================================================================
// 核心功能（复用popup.js的逻辑，简化实现）
// ============================================================================

async function switchProfile(profileId) {
  chrome.runtime.sendMessage({ action: 'setActiveProfile', profileId }, async (response) => {
    if (response.success) {
      await loadProfiles();
      showToast('已切换资料', 'success');
    }
  });
}

async function addNewProfile() {
  const name = prompt('请输入新资料名称:', '新资料');
  if (!name) return;

  chrome.runtime.sendMessage({ action: 'addProfile', name }, async (response) => {
    if (response.success) {
      await loadProfiles();
      showToast('新资料已创建', 'success');
    }
  });
}

async function saveProfile() {
  // 收集表单数据
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

      // 地址信息
      city: document.getElementById('city').value.trim(),
      state: document.getElementById('state').value.trim(),
      country: document.getElementById('country').value.trim(),
      zipCode: document.getElementById('zipCode').value.trim(),
      street: document.getElementById('street').value.trim(),

      // 社交链接
      linkedin: document.getElementById('linkedin').value.trim(),
      github: document.getElementById('github').value.trim(),
      website: document.getElementById('website').value.trim(),
      twitter: document.getElementById('twitter').value.trim()
    },
    education: collectEducationData(),
    workExperience: collectWorkData(),
    projects: collectProjectData(),
    skills: currentProfile.skills,
    introTemplates: {
      default: document.getElementById('introduction').value.trim()
    },
    resumeFile: currentProfile.resumeFile,
    resumeFileName: currentProfile.resumeFileName
  };

  // 收集AI设置
  const settings = {
    aiEnabled: document.getElementById('aiEnabled').checked,
    aiProvider: document.getElementById('aiProvider').value,
    aiApiKey: document.getElementById('aiApiKey').value.trim(),
    aiApiUrl: document.getElementById('aiApiUrl').value.trim()
  };

  // 保存资料
  chrome.runtime.sendMessage({
    action: 'updateProfile',
    profileId: activeProfileId,
    updates
  }, (response1) => {
    // 保存AI设置
    chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings
    }, (response2) => {
      if (response1.success && response2.success) {
        showToast('保存成功', 'success');
      } else {
        showToast('保存失败', 'error');
      }
    });
  });
}

function collectEducationData() {
  const education = [];
  document.querySelectorAll('#educationList .item-card').forEach(card => {
    const id = card.querySelector('.edu-school').getAttribute('data-id');
    education.push({
      id,
      school: card.querySelector('.edu-school').value.trim(),
      major: card.querySelector('.edu-major').value.trim(),
      degree: card.querySelector('.edu-degree').value,
      gpa: card.querySelector('.edu-gpa').value.trim()
    });
  });
  return education;
}

function collectWorkData() {
  const work = [];
  document.querySelectorAll('#workList .item-card').forEach(card => {
    const id = card.querySelector('.work-company').getAttribute('data-id');
    work.push({
      id,
      company: card.querySelector('.work-company').value.trim(),
      position: card.querySelector('.work-position').value.trim(),
      description: card.querySelector('.work-desc').value.trim()
    });
  });
  return work;
}

function collectProjectData() {
  const projects = [];
  document.querySelectorAll('#projectList .item-card').forEach(card => {
    const id = card.querySelector('.proj-name').getAttribute('data-id');
    projects.push({
      id,
      name: card.querySelector('.proj-name').value.trim(),
      role: card.querySelector('.proj-role').value.trim(),
      description: card.querySelector('.proj-desc').value.trim()
    });
  });
  return projects;
}

function addEducation() {
  chrome.runtime.sendMessage({ action: 'addEducation', profileId: activeProfileId }, async () => {
    await loadProfiles();
    showToast('已添加教育经历', 'success');
  });
}

function deleteEducation(eduId) {
  if (!confirm('确定删除？')) return;
  chrome.runtime.sendMessage({
    action: 'deleteEducation',
    profileId: activeProfileId,
    eduId
  }, async () => {
    await loadProfiles();
    showToast('已删除', 'success');
  });
}

function addWorkExperience() {
  chrome.runtime.sendMessage({ action: 'addWorkExperience', profileId: activeProfileId }, async () => {
    await loadProfiles();
  });
}

function deleteWorkExperience(workId) {
  if (!confirm('确定删除？')) return;
  chrome.runtime.sendMessage({
    action: 'deleteWorkExperience',
    profileId: activeProfileId,
    workId
  }, async () => {
    await loadProfiles();
  });
}

function addProject() {
  chrome.runtime.sendMessage({ action: 'addProject', profileId: activeProfileId }, async () => {
    await loadProfiles();
  });
}

function deleteProject(projectId) {
  if (!confirm('确定删除？')) return;
  chrome.runtime.sendMessage({
    action: 'deleteProject',
    profileId: activeProfileId,
    projectId
  }, async () => {
    await loadProfiles();
  });
}

function addSkill() {
  const input = document.getElementById('skillInput');
  const skill = input.value.trim();
  if (!skill) return;

  if (!currentProfile.skills.includes(skill)) {
    currentProfile.skills.push(skill);
    renderSkillsList(currentProfile.skills);
  }
  input.value = '';
}

function removeSkill(skill) {
  currentProfile.skills = currentProfile.skills.filter(s => s !== skill);
  renderSkillsList(currentProfile.skills);
}

function loadIntroductionTemplate(type) {
  const templates = {
    tech: '我是一名热爱技术的开发者，具有扎实的编程基础和良好的学习能力...',
    product: '我是一名对产品充满热情的应届毕业生，具备良好的用户思维...',
    ops: '我是一名热爱互联网运营的应届毕业生，具备较强的内容策划能力...'
  };
  document.getElementById('introduction').value = templates[type] || '';
}

async function handleResumeUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  // 检查文件类型
  const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (!allowedTypes.includes(file.type)) {
    showToast('只支持 PDF、DOC、DOCX 格式', 'error');
    return;
  }

  // 检查文件大小（限制5MB）
  if (file.size > 5 * 1024 * 1024) {
    showToast('文件大小不能超过 5MB', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(event) {
    currentProfile.resumeFile = event.target.result;
    currentProfile.resumeFileName = file.name;
    document.getElementById('resumeFileName').textContent = file.name;
    showToast('简历文件已上传（用于网申填充）', 'success');
  };
  reader.readAsDataURL(file);
}

// AI解析简历文本
async function parseResumeText() {
  const resumeText = document.getElementById('resumeText').value.trim();

  if (!resumeText) {
    showToast('请先粘贴简历内容', 'warning');
    return;
  }

  // 检查AI设置
  const settings = await getSettings();
  if (!settings.aiEnabled || !settings.aiApiKey) {
    showToast('请先在上方配置AI设置并测试连接', 'warning');
    return;
  }

  const btn = document.getElementById('parseTextBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '🤖 解析中...';

  showToast('正在使用AI解析简历，请稍候（约10-30秒）...', 'info');

  try {
    console.log('[AI解析] 开始解析，文本长度:', resumeText.length);
    console.log('[AI解析] 使用提供商:', settings.aiProvider);

    // 直接调用AI解析
    const parsedData = await resumeParser.parseWithAI(resumeText, settings);

    console.log('[AI解析] AI返回数据:', parsedData);

    if (!parsedData) {
      throw new Error('AI未返回数据');
    }

    // 填充解析结果
    console.log('[AI解析] 开始填充数据到表单...');
    await fillParsedData(parsedData);

    console.log('[AI解析] 填充完成，准备保存...');
    console.log('[AI解析] 保存前currentProfile:', currentProfile);

    // 自动保存
    await saveProfile();

    console.log('[AI解析] 保存完成');

    showToast('✅ AI解析成功！数据已自动保存', 'success');

    // 清空文本框
    document.getElementById('resumeText').value = '';

  } catch (error) {
    console.error('[AI解析] 失败:', error);
    console.error('[AI解析] 错误堆栈:', error.stack);
    showToast(`❌ 解析失败: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// 获取AI设置
async function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (response && response.success) {
        resolve(response.settings);
      } else {
        resolve({});
      }
    });
  });
}

// AI解析简历文件（旧方法，暂时禁用）
async function parseResume() {
  showToast('暂不支持直接解析PDF/Word文件。请复制简历内容到上方文本框后点击解析。', 'warning');
}

// 填充AI解析的数据
async function fillParsedData(data) {
  console.log('[AI解析] 开始填充数据:', data);
  console.log('[AI解析] currentProfile:', currentProfile);

  if (!data || typeof data !== 'object') {
    console.error('[AI解析] 数据格式错误:', data);
    throw new Error('AI返回的数据格式不正确');
  }

  // 填充基础信息到currentProfile
  if (data.basicInfo) {
    console.log('[AI解析] 填充基础信息');
    const bi = data.basicInfo;

    // 逐个字段填充并打印日志
    if (bi.fullName) {
      console.log('[AI解析] 姓名:', bi.fullName);
      const elem = document.getElementById('fullName');
      if (elem) {
        elem.value = bi.fullName;
        currentProfile.basicInfo.fullName = bi.fullName;
      } else {
        console.error('[AI解析] 找不到fullName元素');
      }
    }

    if (bi.firstName) {
      console.log('[AI解析] 名:', bi.firstName);
      document.getElementById('firstName').value = bi.firstName;
      currentProfile.basicInfo.firstName = bi.firstName;
    }

    if (bi.lastName) {
      console.log('[AI解析] 姓:', bi.lastName);
      document.getElementById('lastName').value = bi.lastName;
      currentProfile.basicInfo.lastName = bi.lastName;
    }

    if (bi.phone) {
      console.log('[AI解析] 手机:', bi.phone);
      document.getElementById('phone').value = bi.phone;
      currentProfile.basicInfo.phone = bi.phone;
    }

    if (bi.email) {
      console.log('[AI解析] 邮箱:', bi.email);
      document.getElementById('email').value = bi.email;
      currentProfile.basicInfo.email = bi.email;
    }

    if (bi.gender) {
      document.getElementById('gender').value = bi.gender;
      currentProfile.basicInfo.gender = bi.gender;
    }

    if (bi.birthDate) {
      document.getElementById('birthDate').value = bi.birthDate;
      currentProfile.basicInfo.birthDate = bi.birthDate;
    }

    if (bi.city) {
      document.getElementById('city').value = bi.city;
      currentProfile.basicInfo.city = bi.city;
    }

    if (bi.state) {
      document.getElementById('state').value = bi.state;
      currentProfile.basicInfo.state = bi.state;
    }

    if (bi.linkedin) {
      document.getElementById('linkedin').value = bi.linkedin;
      currentProfile.basicInfo.linkedin = bi.linkedin;
    }

    if (bi.github) {
      document.getElementById('github').value = bi.github;
      currentProfile.basicInfo.github = bi.github;
    }

    if (bi.website) {
      document.getElementById('website').value = bi.website;
      currentProfile.basicInfo.website = bi.website;
    }

    console.log('[AI解析] 基础信息填充完成');
  }

  // 填充教育经历
  if (data.education && data.education.length > 0) {
    console.log('[AI解析] 填充教育经历，数量:', data.education.length);
    const validEducation = data.education.filter(edu => edu.school || edu.major);

    if (validEducation.length > 0) {
      console.log('[AI解析] 有效教育经历:', validEducation.length);

      // 清空现有的，从第一个开始
      // 如果已有教育经历，使用第一个，否则添加
      for (let i = 0; i < validEducation.length; i++) {
        if (i >= currentProfile.education.length) {
          console.log('[AI解析] 添加新教育经历', i + 1);
          await chrome.runtime.sendMessage({ action: 'addEducation', profileId: activeProfileId });
          await new Promise(resolve => setTimeout(resolve, 100));
          await loadProfiles(); // 重新加载获取新添加的
        }
      }

      // 填充数据
      validEducation.forEach((edu, index) => {
        if (currentProfile.education[index]) {
          console.log('[AI解析] 填充教育', index + 1, ':', edu.school, edu.major);
          Object.assign(currentProfile.education[index], edu);
        }
      });

      // 重新渲染
      console.log('[AI解析] 重新渲染教育列表');
      renderEducationList(currentProfile.education);
    }
  }

  // 填充工作经历
  if (data.workExperience && data.workExperience.length > 0) {
    console.log('[AI解析] 填充工作经历，数量:', data.workExperience.length);
    const validWork = data.workExperience.filter(work => work.company || work.position);

    if (validWork.length > 0) {
      for (let i = 0; i < validWork.length; i++) {
        if (i >= currentProfile.workExperience.length) {
          console.log('[AI解析] 添加新工作经历', i + 1);
          await chrome.runtime.sendMessage({ action: 'addWorkExperience', profileId: activeProfileId });
          await new Promise(resolve => setTimeout(resolve, 100));
          await loadProfiles();
        }
      }

      validWork.forEach((work, index) => {
        if (currentProfile.workExperience[index]) {
          console.log('[AI解析] 填充工作', index + 1, ':', work.company, work.position);
          Object.assign(currentProfile.workExperience[index], work);
        }
      });

      console.log('[AI解析] 重新渲染工作列表');
      renderWorkList(currentProfile.workExperience);
    }
  }

  // 填充项目经历
  if (data.projects && data.projects.length > 0) {
    console.log('[AI解析] 填充项目经历，数量:', data.projects.length);
    const validProjects = data.projects.filter(proj => proj.name);

    if (validProjects.length > 0) {
      for (let i = 0; i < validProjects.length; i++) {
        if (i >= currentProfile.projects.length) {
          console.log('[AI解析] 添加新项目', i + 1);
          await chrome.runtime.sendMessage({ action: 'addProject', profileId: activeProfileId });
          await new Promise(resolve => setTimeout(resolve, 100));
          await loadProfiles();
        }
      }

      validProjects.forEach((proj, index) => {
        if (currentProfile.projects[index]) {
          console.log('[AI解析] 填充项目', index + 1, ':', proj.name);
          Object.assign(currentProfile.projects[index], proj);
        }
      });

      console.log('[AI解析] 重新渲染项目列表');
      renderProjectList(currentProfile.projects);
    }
  }

  // 填充技能
  if (data.skills && data.skills.length > 0) {
    console.log('[AI解析] 填充技能，数量:', data.skills.length);
    currentProfile.skills = data.skills;
    renderSkillsList(currentProfile.skills);
  }

  // 填充自我介绍
  if (data.introduction) {
    console.log('[AI解析] 填充自我介绍');
    document.getElementById('introduction').value = data.introduction;
    currentProfile.introTemplates.default = data.introduction;
  }

  console.log('[AI解析] 数据填充完成，currentProfile:', currentProfile);
}

async function deleteCurrentProfile() {
  if (!confirm('确定要删除当前资料吗？此操作不可恢复。')) return;

  chrome.runtime.sendMessage({ action: 'deleteProfile', profileId: activeProfileId }, async (response) => {
    if (response.success) {
      await loadProfiles();
      showToast('资料已删除', 'success');
    } else {
      showToast('至少需要保留一份资料', 'warning');
    }
  });
}

// 自动保存AI设置（单独保存，不影响资料）
async function autoSaveAiSettings() {
  const settings = {
    aiEnabled: document.getElementById('aiEnabled').checked,
    aiProvider: document.getElementById('aiProvider').value,
    aiApiKey: document.getElementById('aiApiKey').value.trim(),
    aiApiUrl: document.getElementById('aiApiUrl').value.trim()
  };

  console.log('[AI设置] 自动保存:', settings.aiProvider, settings.aiEnabled);

  chrome.runtime.sendMessage({
    action: 'updateSettings',
    settings
  }, (response) => {
    if (response && response.success) {
      console.log('[AI设置] 已自动保存');
      // 静默保存，不显示Toast
    }
  });
}

// 测试AI连接
async function testAiConnection() {
  const provider = document.getElementById('aiProvider').value;
  const apiKey = document.getElementById('aiApiKey').value.trim();
  const apiUrl = document.getElementById('aiApiUrl').value.trim();

  if (!apiKey) {
    showToast('请先输入API Key', 'warning');
    return;
  }

  const btn = document.getElementById('testAiBtn');
  const resultDiv = document.getElementById('testResult');

  btn.disabled = true;
  btn.textContent = '🔍 测试中...';
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div style="color: #3b82f6;">正在连接...</div>';

  console.log('[AI测试] 开始测试');
  console.log('[AI测试] 提供商:', provider);
  console.log('[AI测试] API Key前8位:', apiKey.substring(0, 8) + '...');
  console.log('[AI测试] API URL:', apiUrl || '默认');

  const settings = {
    aiEnabled: true,
    aiProvider: provider,
    aiApiKey: apiKey,
    aiApiUrl: apiUrl
  };

  try {
    // 发送一个简单的测试请求
    const testPrompt = '回复"OK"即可';

    console.log('[AI测试] 发送测试请求...');
    const startTime = Date.now();

    const result = await resumeParser.parseWithAI(testPrompt, settings);

    const duration = Date.now() - startTime;
    console.log('[AI测试] 成功，耗时:', duration + 'ms');
    console.log('[AI测试] 返回结果:', result);

    btn.disabled = false;
    btn.textContent = '🔍 测试连接';
    resultDiv.innerHTML = `
      <div style="background: #d1fae5; color: #065f46; padding: 10px; border-radius: 6px; border: 1px solid #10b981;">
        <strong>✅ 连接成功！</strong><br>
        响应时间: ${duration}ms<br>
        可以开始使用AI解析功能
      </div>
    `;
    showToast('✅ AI连接测试成功', 'success');

  } catch (error) {
    btn.disabled = false;
    btn.textContent = '🔍 测试连接';

    console.error('[AI测试] 失败:', error);
    console.error('[AI测试] 错误详情:', error.message);

    // 分析错误类型
    let errorType = '未知错误';
    let suggestion = '';

    if (error.message.includes('401') || error.message.includes('403') || error.message.includes('Unauthorized')) {
      errorType = 'API Key无效';
      suggestion = '1. 检查API Key是否正确<br>2. 确认没有多余空格<br>3. 尝试重新生成Key';
    } else if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('Failed to fetch')) {
      errorType = '网络连接失败';
      suggestion = '1. 检查网络连接<br>2. 尝试访问官网<br>3. 检查是否需要VPN';
    } else if (error.message.includes('model')) {
      errorType = '模型不可用';
      suggestion = '1. 切换其他提供商<br>2. 确认账号已充值<br>3. 检查模型名称';
    } else if (error.message.includes('balance') || error.message.includes('quota')) {
      errorType = '余额不足';
      suggestion = '1. 登录控制台充值<br>2. DeepSeek最低10元';
    }

    resultDiv.innerHTML = `
      <div style="background: #fee2e2; color: #991b1b; padding: 10px; border-radius: 6px; border: 1px solid #ef4444;">
        <strong>❌ 连接失败：${errorType}</strong><br>
        <div style="margin-top: 8px; font-size: 11px;">
          ${suggestion}
        </div>
        <details style="margin-top: 8px;">
          <summary style="cursor: pointer; font-size: 11px;">查看详细错误</summary>
          <pre style="margin-top: 4px; font-size: 10px; background: #fff; padding: 4px; border-radius: 4px; overflow-x: auto;">${error.message}</pre>
        </details>
      </div>
    `;

    showToast(`❌ 测试失败: ${errorType}`, 'error');
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}
