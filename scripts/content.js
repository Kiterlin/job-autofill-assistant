// ============================================================================
// Content Script - 页面表单自动填充
// 融合自 ApplyEase 的表单识别和填充逻辑
// ============================================================================

(function() {
  'use strict';

  // ========================================================================
  // 工具函数 - 从 ApplyEase 移植并改进
  // ========================================================================

  // 设置输入框的值（兼容React/Vue等框架）
  function setValue(element, value) {
    if (!element) return false;

    element.focus();

    // 获取原生setter（绕过框架劫持）
    const tagName = element.tagName.toLowerCase();
    let nativeSetter;

    if (tagName === 'textarea') {
      nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    } else if (tagName === 'select') {
      nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    } else {
      nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    }

    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }

    // 触发事件通知框架
    ['input', 'change', 'blur'].forEach(eventType => {
      element.dispatchEvent(new Event(eventType, { bubbles: true }));
    });

    element.blur();
    return true;
  }

  // 获取元素关联的label文本
  function getClosestLabelText(input) {
    try {
      // 1. 通过for属性关联的label
      if (input.id) {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) return label.textContent.toLowerCase().trim();
      }

      // 2. 父级label
      const parentLabel = input.closest('label');
      if (parentLabel) return parentLabel.textContent.toLowerCase().trim();

      // 3. 同级label
      const prevLabel = input.previousElementSibling;
      if (prevLabel && prevLabel.tagName === 'LABEL') {
        return prevLabel.textContent.toLowerCase().trim();
      }

      // 4. 父容器中的label
      const container = input.parentElement;
      if (container) {
        const containerLabel = container.querySelector('label');
        if (containerLabel) return containerLabel.textContent.toLowerCase().trim();
      }

      return '';
    } catch {
      return '';
    }
  }

  // 获取元素的所有识别特征
  function getElementFeatures(element) {
    const name = (element.name || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    const placeholder = (element.placeholder || '').toLowerCase();
    const label = getClosestLabelText(element);
    const className = (element.className || '').toLowerCase();

    return {
      name,
      id,
      placeholder,
      label,
      className,
      combined: `${name} ${id} ${placeholder} ${label} ${className}`
    };
  }

  // 字段匹配规则（中英文）
  const FIELD_PATTERNS = {
    // 姓名相关
    fullName: [
      /^(full[-_\s]?name|name|姓名|真实姓名|用户名称)$/i,
      /姓名|name/i
    ],
    firstName: [
      /^(first[-_\s]?name|given[-_\s]?name|名|firstname)$/i,
      /first|given|名字/i
    ],
    lastName: [
      /^(last[-_\s]?name|surname|family[-_\s]?name|姓|lastname)$/i,
      /last|surname|family|姓氏/i
    ],
    middleName: [
      /^(middle[-_\s]?name|middlename)$/i,
      /middle.*name/i
    ],

    // 联系方式
    phone: [
      /^(phone|mobile|tel|telephone|联系电话|手机|电话|contact)$/i,
      /phone|mobile|tel|电话|手机/i
    ],
    phoneType: [
      /^(phone[-_\s]?type)$/i,
      /phone.*type/i
    ],
    email: [
      /^(email|e[-_]?mail|邮箱|电子邮箱|mail)$/i,
      /email|mail|邮箱/i
    ],

    // 个人信息
    gender: [
      /^(gender|sex|性别)$/i,
      /gender|sex|性别/i
    ],
    birthDate: [
      /^(birth|birthday|birthdate|dob|出生日期|生日|date.*birth)$/i,
      /birth|生日|出生/i
    ],
    idCard: [
      /^(id[-_]?card|identity|身份证|证件号)$/i,
      /身份证|idcard|identity/i
    ],

    // 地址信息（详细拆分）
    street: [
      /^(street|address.*line|addr.*line|street.*addr|街道)$/i,
      /street|街道|address.*1/i
    ],
    city: [
      /^(city|城市)$/i,
      /city|城市/i
    ],
    state: [
      /^(state|province|region|州|省|地区)$/i,
      /state|province|region|州|省/i
    ],
    country: [
      /^(country|nation|国家)$/i,
      /country|国家/i
    ],
    zipCode: [
      /^(zip|postal|postcode|邮编|邮政编码)$/i,
      /zip|postal|邮编/i
    ],
    location: [
      /^(location|address|所在地|居住地)$/i,
      /location|地址|所在地/i
    ],

    // 社交链接
    linkedin: [
      /^(linkedin|linked[-_]?in)$/i,
      /linkedin/i
    ],
    github: [
      /^(github|git[-_]?hub)$/i,
      /github/i
    ],
    website: [
      /^(website|homepage|personal.*site|个人网站)$/i,
      /website|homepage|个人.*网站/i
    ],
    twitter: [
      /^(twitter|x\.com)$/i,
      /twitter/i
    ],

    // 教育信息
    school: [
      /^(school|university|college|edu|学校|院校|毕业院校)$/i,
      /school|university|college|学校|院校/i
    ],
    major: [
      /^(major|专业|所学专业|discipline)$/i,
      /major|专业|学科|discipline/i
    ],
    degree: [
      /^(degree|学历|education|edu.*level)$/i,
      /degree|学历|education/i
    ],
    gpa: [
      /^(gpa|grade|score|绩点|成绩|平均分)$/i,
      /gpa|绩点|成绩/i
    ],

    // 工作经验
    company: [
      /^(company|employer|org|公司|单位|工作单位)$/i,
      /company|公司|单位|employer/i
    ],
    position: [
      /^(position|title|job|role|职位|岗位|职务)$/i,
      /position|title|job|职位|岗位/i
    ],

    // 项目经验
    projectName: [
      /^(project|项目名称|proj.*name)$/i,
      /project.*name|项目名称/i
    ],

    // 技能
    skills: [
      /^(skill|技能|专业技能|特长)$/i,
      /skill|技能|特长/i
    ],

    // 自我介绍
    introduction: [
      /^(intro|self.*intro|个人简介|自我介绍|about)$/i,
      /intro|简介|自我介绍|about.*me/i
    ],

    // 简历上传
    resume: [
      /^(resume|cv|简历|附件)$/i,
      /resume|cv|简历|attachment/i
    ]
  };

  // 匹配字段类型
  function matchFieldType(element) {
    const features = getElementFeatures(element);

    for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(features.combined)) {
          return fieldType;
        }
      }
    }

    return null;
  }

  // ========================================================================
  // 表单扫描与填充
  // ========================================================================

  async function fillForm(profile) {
    if (!profile) {
      console.log('[秋招助手] 未找到激活的资料');
      return;
    }

    let filledCount = 0;
    const results = [];

    // 1. 扫描所有可填充的输入框
    const inputs = document.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], ' +
      'input[type="number"], input[type="date"], input:not([type]), ' +
      'textarea, select'
    );

    console.log(`[秋招助手] 扫描到 ${inputs.length} 个输入框`);

    for (const input of inputs) {
      // 跳过禁用和只读字段
      if (input.disabled || input.readOnly) continue;

      // 跳过已填写的字段
      if (input.value && input.value.trim() !== '') continue;

      const fieldType = matchFieldType(input);
      if (!fieldType) continue;

      let valueToFill = null;

      // 根据字段类型填充对应的值
      switch (fieldType) {
        // 基础信息
        case 'fullName':
          valueToFill = profile.basicInfo.fullName;
          break;
        case 'firstName':
          valueToFill = profile.basicInfo.firstName;
          break;
        case 'lastName':
          valueToFill = profile.basicInfo.lastName;
          break;
        case 'middleName':
          valueToFill = profile.basicInfo.middleName;
          break;
        case 'phone':
          valueToFill = profile.basicInfo.phone;
          break;
        case 'phoneType':
          valueToFill = profile.basicInfo.phoneType;
          break;
        case 'email':
          valueToFill = profile.basicInfo.email;
          break;
        case 'gender':
          valueToFill = profile.basicInfo.gender;
          break;
        case 'birthDate':
          valueToFill = profile.basicInfo.birthDate;
          break;
        case 'idCard':
          valueToFill = profile.basicInfo.idCard;
          break;

        // 地址信息
        case 'street':
          valueToFill = profile.basicInfo.street;
          break;
        case 'city':
          valueToFill = profile.basicInfo.city;
          break;
        case 'state':
          valueToFill = profile.basicInfo.state;
          break;
        case 'country':
          valueToFill = profile.basicInfo.country;
          break;
        case 'zipCode':
          valueToFill = profile.basicInfo.zipCode;
          break;
        case 'location':
          valueToFill = profile.basicInfo.location || profile.basicInfo.address ||
                        `${profile.basicInfo.city} ${profile.basicInfo.state}`.trim();
          break;

        // 社交链接
        case 'linkedin':
          valueToFill = profile.basicInfo.linkedin;
          break;
        case 'github':
          valueToFill = profile.basicInfo.github;
          break;
        case 'website':
          valueToFill = profile.basicInfo.website;
          break;
        case 'twitter':
          valueToFill = profile.basicInfo.twitter;
          break;

        // 教育信息（取第一条）
        case 'school':
          if (profile.education[0]) valueToFill = profile.education[0].school;
          break;
        case 'major':
          if (profile.education[0]) valueToFill = profile.education[0].major;
          break;
        case 'degree':
          if (profile.education[0]) valueToFill = profile.education[0].degree;
          break;
        case 'gpa':
          if (profile.education[0]) valueToFill = profile.education[0].gpa;
          break;

        // 工作经验（取第一条）
        case 'company':
          if (profile.workExperience[0]) valueToFill = profile.workExperience[0].company;
          break;
        case 'position':
          if (profile.workExperience[0]) valueToFill = profile.workExperience[0].position;
          break;

        // 项目（取第一条）
        case 'projectName':
          if (profile.projects[0]) valueToFill = profile.projects[0].name;
          break;

        // 技能
        case 'skills':
          valueToFill = profile.skills.join(', ');
          break;

        // 自我介绍
        case 'introduction':
          valueToFill = profile.introTemplates.default;
          break;
      }

      // 填充值
      if (valueToFill && valueToFill.trim() !== '') {
        const success = setValue(input, valueToFill);
        if (success) {
          filledCount++;
          results.push({
            element: input,
            fieldType: fieldType,
            value: valueToFill
          });

          // 高亮显示已填充的字段
          input.style.backgroundColor = '#e8f5e9';
          input.style.border = '2px solid #4caf50';

          console.log(`[秋招助手] 填充: ${fieldType} = ${valueToFill}`);
        }
      }
    }

    // 2. 处理简历文件上传
    await handleResumeUpload(profile);

    console.log(`[秋招助手] 填充完成: ${filledCount} 个字段`);

    // 显示通知
    showNotification(`已自动填充 ${filledCount} 个字段`, 'success');

    return { filledCount, results };
  }

  // 处理简历上传
  async function handleResumeUpload(profile) {
    if (!profile.resumeFile) return;

    // 查找简历上传输入框
    const fileInputs = document.querySelectorAll('input[type="file"]');

    for (const input of fileInputs) {
      const fieldType = matchFieldType(input);
      if (fieldType === 'resume' || getElementFeatures(input).combined.includes('resume') ||
          getElementFeatures(input).combined.includes('简历') ||
          getElementFeatures(input).combined.includes('cv')) {

        try {
          // 从base64创建File对象
          const response = await fetch(profile.resumeFile);
          const blob = await response.blob();
          const file = new File([blob], profile.resumeFileName || 'resume.pdf', {
            type: blob.type || 'application/pdf'
          });

          // 创建DataTransfer对象
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          input.files = dataTransfer.files;

          // 触发change事件
          input.dispatchEvent(new Event('change', { bubbles: true }));

          console.log('[秋招助手] 简历上传成功');
          input.style.backgroundColor = '#e8f5e9';
          input.style.border = '2px solid #4caf50';

        } catch (e) {
          console.error('[秋招助手] 简历上传失败:', e);
        }
      }
    }
  }

  // ========================================================================
  // 悬浮按钮UI
  // ========================================================================

  function createFloatingButton() {
    // 避免重复创建
    if (document.getElementById('job-autofill-button')) return;

    const button = document.createElement('div');
    button.id = 'job-autofill-button';
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
        <path d="M9 2C7.89 2 7 2.89 7 4V20C7 21.11 7.89 22 9 22H18C19.11 22 20 21.11 20 20V8L14 2H9M13 3.5L18.5 9H13V3.5M12 11V13H16V11H12M12 15V17H16V15H12Z"/>
      </svg>
    `;

    button.addEventListener('click', async () => {
      button.classList.add('loading');

      try {
        // 向background发送消息获取当前资料
        chrome.runtime.sendMessage({ action: 'getActiveProfile' }, async (response) => {
          if (response && response.profile) {
            await fillForm(response.profile);
          } else {
            showNotification('请先在插件中配置个人资料', 'warning');
          }
          button.classList.remove('loading');
        });
      } catch (e) {
        console.error('[秋招助手] 填充失败:', e);
        showNotification('填充失败，请重试', 'error');
        button.classList.remove('loading');
      }
    });

    document.body.appendChild(button);
  }

  // 显示通知
  function showNotification(message, type = 'info') {
    // 移除旧通知
    const oldNotif = document.getElementById('job-autofill-notification');
    if (oldNotif) oldNotif.remove();

    const notification = document.createElement('div');
    notification.id = 'job-autofill-notification';
    notification.className = `job-autofill-notif ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    // 3秒后自动消失
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // ========================================================================
  // 悬浮按钮
  // ========================================================================

  function createFloatingButton() {
    // 检查是否已存在
    if (document.getElementById('job-autofill-float-btn')) {
      return;
    }

    const floatBtn = document.createElement('div');
    floatBtn.id = 'job-autofill-float-btn';
    floatBtn.innerHTML = `
      <div class="float-btn-icon">✨</div>
      <div class="float-btn-text">填充</div>
    `;

    floatBtn.addEventListener('click', () => {
      floatBtn.classList.add('loading');

      // 获取当前激活的资料
      chrome.runtime.sendMessage({ action: 'getActiveProfile' }, (response) => {
        if (response && response.success && response.profile) {
          fillForm(response.profile).then(result => {
            floatBtn.classList.remove('loading');
            showNotification(`✅ 已填充 ${result.filledCount} 个字段`);
          }).catch(error => {
            floatBtn.classList.remove('loading');
            showNotification(`❌ ${error.message}`, 'error');
          });
        } else {
          floatBtn.classList.remove('loading');
          showNotification('⚠️ 请先配置资料', 'warning');
        }
      });
    });

    document.body.appendChild(floatBtn);
  }

  // 显示通知
  function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `job-autofill-notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('show');
    }, 10);

    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // ========================================================================
  // 初始化
  // ========================================================================

  function init() {
    console.log('[秋招助手] Content Script 已加载');

    // 创建悬浮按钮
    setTimeout(createFloatingButton, 1000);

    // 监听来自popup的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'fillForm') {
        fillForm(request.profile).then(result => {
          sendResponse({ success: true, result });
        });
        return true; // 异步响应
      }
    });
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
