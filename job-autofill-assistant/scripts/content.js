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

    // 政治面貌与身份背景
    politicalStatus: [
      /^(political|party|政治面貌|党派)$/i,
      /政治面貌|political.*status|党派/i
    ],
    ethnicity: [
      /^(ethnicity|ethnic|nation|民族)$/i,
      /民族|ethnicity/i
    ],
    hometown: [
      /^(hometown|native.*place|origin|籍贯|生源地|户籍|户口所在地)$/i,
      /籍贯|生源地|户籍所在地|户口所在地/i
    ],
    graduationDate: [
      /^(graduation|grad.*date|毕业时间|毕业年月|预计毕业)$/i,
      /毕业时间|毕业年月|预计毕业/i
    ],

    // 紧急联系人
    emergencyContact: [
      /^(emergency.*contact|emergency.*name|紧急联系人|紧急联络人)$/i,
      /紧急联系人|紧急联络人/i
    ],
    emergencyRelation: [
      /^(emergency.*relation|relationship|与本人关系|关系)$/i,
      /紧急.*关系|与本人关系/i
    ],
    emergencyPhone: [
      /^(emergency.*phone|emergency.*tel|紧急联系电话|紧急联系人手机)$/i,
      /紧急.*电话|紧急.*手机/i
    ],

    // 求职意向
    expectedCity: [
      /^(expected.*city|target.*city|期望城市|意向城市|期望工作地|意向工作地点)$/i,
      /期望城市|意向城市|期望工作地点/i
    ],
    expectedPosition: [
      /^(expected.*position|target.*job|期望岗位|意向岗位|求职岗位|目标职位|应聘职位)$/i,
      /期望岗位|意向职位|求职意向|目标岗位|应聘职位/i
    ],
    expectedSalary: [
      /^(expected.*salary|salary|期望薪资|期望月薪|期望年薪|薪资要求)$/i,
      /期望薪资|期望月薪|薪资要求/i
    ],
    availableDate: [
      /^(available.*date|start.*work|到岗时间|入职时间|最快到岗)$/i,
      /到岗时间|最快到岗|入职时间/i
    ],
    referralCode: [
      /^(referral.*code|recommender|内推码|推荐码|推荐人|伯乐码)$/i,
      /内推码|推荐码|推荐人|伯乐码/i
    ],

    // 语言能力
    cet4: [
      /^(cet[-_\s]?4|四级|英语四级|四级成绩)$/i,
      /四级|cet[-_\s]?4/i
    ],
    cet6: [
      /^(cet[-_\s]?6|六级|英语六级|六级成绩)$/i,
      /六级|cet[-_\s]?6/i
    ],
    ielts: [
      /^(ielts|雅思|雅思成绩)$/i,
      /ielts|雅思/i
    ],
    toefl: [
      /^(toefl|托福|托福成绩)$/i,
      /toefl|托福/i
    ],

    // 荣誉奖项
    awards: [
      /^(awards|honors|荣誉|奖项|获奖经历|竞赛获奖)$/i,
      /荣誉|奖项|获奖经历|竞赛/i
    ],

    // 教育信息
    school: [
      /^(school|university|college|edu|学校|院校|毕业院校|毕业学校)$/i,
      /school|university|college|学校|院校/i
    ],
    college: [
      /^(department|faculty|college.*name|学院|院系|所属学院)$/i,
      /学院|院系/i
    ],
    major: [
      /^(major|专业|所学专业|discipline)$/i,
      /major|专业|学科|discipline/i
    ],
    degree: [
      /^(degree|学历|education|edu.*level)$/i,
      /degree|学历|education/i
    ],
    degreeType: [
      /^(degree.*type|study.*type|培养方式|学习形式|学历类型|统招)$/i,
      /培养方式|学历类型|全日制/i
    ],
    gpa: [
      /^(gpa|grade|score|绩点|成绩|平均分|平均绩点)$/i,
      /gpa|绩点|成绩/i
    ],
    rank: [
      /^(rank|ranking|排名|成绩排名|专业排名|班级排名)$/i,
      /专业排名|成绩排名|班级排名/i
    ],
    courses: [
      /^(courses|major.*courses|主修课程|核心课程|专业课程)$/i,
      /主修课程|核心课程|专业课/i
    ],

    // 工作经验
    company: [
      /^(company|employer|org|公司|单位|工作单位|实习单位)$/i,
      /company|公司|单位|employer/i
    ],
    department: [
      /^(dept|department|部门|所属部门|业务线)$/i,
      /所属部门|实习部门|业务线/i
    ],
    position: [
      /^(position|title|job|role|职位|岗位|职务)$/i,
      /position|title|job|职位|岗位/i
    ],
    workCity: [
      /^(work.*city|job.*location|实习地点|工作城市)$/i,
      /工作地点|实习地点|工作城市/i
    ],
    workDescription: [
      /^(work.*desc|job.*desc|工作内容|工作职责|实习职责|工作描述)$/i,
      /工作内容|工作职责|工作描述/i
    ],
    workAchievements: [
      /^(achievements|work.*output|工作成果|量化成果|实习产出|主要业绩)$/i,
      /工作成果|主要业绩|量化成果/i
    ],

    // 项目经验
    projectName: [
      /^(project|项目名称|proj.*name)$/i,
      /project.*name|项目名称/i
    ],
    techStack: [
      /^(tech.*stack|technologies|技术栈|关键技术|使用技术)$/i,
      /技术栈|关键技术|开发技术/i
    ],
    projectUrl: [
      /^(project.*url|demo.*url|项目链接|作品链接|在线地址)$/i,
      /项目链接|作品链接|github.*url/i
    ],
    projectDescription: [
      /^(project.*desc|proj.*desc|项目描述|项目背景|项目简介)$/i,
      /项目描述|项目背景|项目简介/i
    ],
    projectResponsibilities: [
      /^(project.*resp|proj.*role|个人职责|项目职责|难点攻关)$/i,
      /个人职责|项目职责|个人分工/i
    ],
    projectAchievements: [
      /^(project.*achieve|项目成果|竞赛产出|项目业绩)$/i,
      /项目成果|项目业绩/i
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
      console.log('[Capybara助手] 未找到激活的资料');
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

    console.log(`[Capybara助手] 扫描到 ${inputs.length} 个输入框`);
    if (typeof appLog !== 'undefined') {
      appLog.info('content', 'fill.scan', `扫描到 ${inputs.length} 个输入框`, {
        url: location.href,
        profile: profile && profile.name
      });
    }

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
          valueToFill = profile.basicInfo?.fullName;
          break;
        case 'firstName':
          valueToFill = profile.basicInfo?.firstName;
          break;
        case 'lastName':
          valueToFill = profile.basicInfo?.lastName;
          break;
        case 'middleName':
          valueToFill = profile.basicInfo?.middleName;
          break;
        case 'phone':
          valueToFill = profile.basicInfo?.phone;
          break;
        case 'phoneType':
          valueToFill = profile.basicInfo?.phoneType;
          break;
        case 'email':
          valueToFill = profile.basicInfo?.email;
          break;
        case 'gender':
          valueToFill = profile.basicInfo?.gender;
          break;
        case 'birthDate':
          valueToFill = profile.basicInfo?.birthDate;
          break;
        case 'idCard':
          valueToFill = profile.basicInfo?.idCard;
          break;
        case 'politicalStatus':
          valueToFill = profile.basicInfo?.politicalStatus;
          break;
        case 'ethnicity':
          valueToFill = profile.basicInfo?.ethnicity;
          break;
        case 'hometown':
          valueToFill = profile.basicInfo?.hometown;
          break;
        case 'graduationDate':
          valueToFill = profile.basicInfo?.graduationDate;
          break;
        case 'emergencyContact':
          valueToFill = profile.basicInfo?.emergencyContact;
          break;
        case 'emergencyRelation':
          valueToFill = profile.basicInfo?.emergencyRelation;
          break;
        case 'emergencyPhone':
          valueToFill = profile.basicInfo?.emergencyPhone;
          break;

        // 求职意向
        case 'expectedCity':
          valueToFill = profile.jobIntention?.expectedCity;
          break;
        case 'expectedPosition':
          valueToFill = profile.jobIntention?.expectedPosition;
          break;
        case 'expectedSalary':
          valueToFill = profile.jobIntention?.expectedSalary;
          break;
        case 'availableDate':
          valueToFill = profile.jobIntention?.availableDate;
          break;
        case 'referralCode':
          valueToFill = profile.jobIntention?.referralCode;
          break;

        // 语言外语
        case 'cet4':
          valueToFill = profile.languageSkills?.cet4;
          break;
        case 'cet6':
          valueToFill = profile.languageSkills?.cet6;
          break;
        case 'ielts':
          valueToFill = profile.languageSkills?.ielts;
          break;
        case 'toefl':
          valueToFill = profile.languageSkills?.toefl;
          break;

        // 荣誉奖项
        case 'awards':
          if (Array.isArray(profile.awards) && profile.awards.length) {
            valueToFill = profile.awards.map(a => `${a.date || ''} ${a.name} (${a.level || '校级'})`.trim()).join('；');
          }
          break;

        // 地址信息
        case 'street':
          valueToFill = profile.basicInfo?.street;
          break;
        case 'city':
          valueToFill = profile.basicInfo?.city;
          break;
        case 'state':
          valueToFill = profile.basicInfo?.state;
          break;
        case 'country':
          valueToFill = profile.basicInfo?.country;
          break;
        case 'zipCode':
          valueToFill = profile.basicInfo?.zipCode;
          break;
        case 'location':
          valueToFill = profile.basicInfo?.location || profile.basicInfo?.address ||
                        `${profile.basicInfo?.city || ''} ${profile.basicInfo?.state || ''}`.trim();
          break;

        // 社交链接
        case 'linkedin':
          valueToFill = profile.basicInfo?.linkedin;
          break;
        case 'github':
          valueToFill = profile.basicInfo?.github;
          break;
        case 'website':
          valueToFill = profile.basicInfo?.website;
          break;
        case 'twitter':
          valueToFill = profile.basicInfo?.twitter;
          break;

        // 教育信息（取第一条）
        case 'school':
          if (profile.education?.[0]) valueToFill = profile.education[0].school;
          break;
        case 'college':
          if (profile.education?.[0]) valueToFill = profile.education[0].college;
          break;
        case 'major':
          if (profile.education?.[0]) valueToFill = profile.education[0].major;
          break;
        case 'degree':
          if (profile.education?.[0]) valueToFill = profile.education[0].degree;
          break;
        case 'degreeType':
          if (profile.education?.[0]) valueToFill = profile.education[0].degreeType;
          break;
        case 'gpa':
          if (profile.education?.[0]) valueToFill = profile.education[0].gpa;
          break;
        case 'rank':
          if (profile.education?.[0]) valueToFill = profile.education[0].rank;
          break;
        case 'courses':
          if (profile.education?.[0]) valueToFill = profile.education[0].courses;
          break;

        // 工作经验（取第一条）
        case 'company':
          if (profile.workExperience?.[0]) valueToFill = profile.workExperience[0].company;
          break;
        case 'department':
          if (profile.workExperience?.[0]) valueToFill = profile.workExperience[0].department;
          break;
        case 'position':
          if (profile.workExperience?.[0]) valueToFill = profile.workExperience[0].position;
          break;
        case 'workCity':
          if (profile.workExperience?.[0]) valueToFill = profile.workExperience[0].city;
          break;
        case 'workDescription':
          if (profile.workExperience?.[0]) valueToFill = profile.workExperience[0].description;
          break;
        case 'workAchievements':
          if (profile.workExperience?.[0]) valueToFill = profile.workExperience[0].achievements;
          break;

        // 项目（取第一条）
        case 'projectName':
          if (profile.projects?.[0]) valueToFill = profile.projects[0].name;
          break;
        case 'techStack':
          if (profile.projects?.[0]) valueToFill = profile.projects[0].techStack;
          break;
        case 'projectUrl':
          if (profile.projects?.[0]) valueToFill = profile.projects[0].projectUrl;
          break;
        case 'projectDescription':
          if (profile.projects?.[0]) valueToFill = profile.projects[0].description;
          break;
        case 'projectResponsibilities':
          if (profile.projects?.[0]) valueToFill = profile.projects[0].responsibilities;
          break;
        case 'projectAchievements':
          if (profile.projects?.[0]) valueToFill = profile.projects[0].achievements;
          break;

        // 技能
        case 'skills':
          valueToFill = Array.isArray(profile.skills) ? profile.skills.join(', ') : '';
          break;

        // 自我介绍
        case 'introduction':
          valueToFill = profile.introTemplates?.default || '';
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

          console.log(`[Capybara助手] 填充: ${fieldType} = ${valueToFill}`);
        }
      }
    }

    // 2. 处理简历文件上传
    await handleResumeUpload(profile);

    console.log(`[Capybara助手] 填充完成: ${filledCount} 个字段`);
    if (typeof appLog !== 'undefined') {
      appLog.success('content', 'fill.done', `页面填充完成，${filledCount} 个字段`, { url: location.href });
    }

    // 3. 自动记录投递历史（提取公司、岗位、网址与所用资料）
    if (filledCount > 0) {
      try {
        const company = detectCompanyName();
        const position = detectPositionName();
        chrome.runtime.sendMessage({
          action: 'recordSubmission',
          data: {
            company,
            position,
            url: window.location.href,
            date: new Date().toISOString().slice(0, 10),
            profileId: profile.id || '',
            profileName: profile.name || '默认资料',
            status: '在投'
          }
        }, (res) => {
          if (res && res.success) {
            console.log('[Capybara助手] 已自动记录投递历史:', company, position);
          }
        });
      } catch (e) {
        console.warn('[Capybara助手] 记录投递历史失败:', e);
      }
    }

    // 显示通知
    showNotification(`已自动填充 ${filledCount} 个字段 · 投递历史已记录`, 'success');

    return { filledCount, results };
  }

  // ========================================================================
  // 网页公司与岗位智能提取
  // ========================================================================

  function detectCompanyName() {
    const host = window.location.hostname.toLowerCase();
    const KNOWN_DOMAINS = [
      { match: /tencent/i, name: '腾讯' },
      { match: /bytedance|douyin/i, name: '字节跳动' },
      { match: /alibaba|aliyun|taobao|tmall/i, name: '阿里巴巴' },
      { match: /meituan/i, name: '美团' },
      { match: /baidu/i, name: '百度' },
      { match: /kuaishou/i, name: '快手' },
      { match: /xiaohongshu/i, name: '小红书' },
      { match: /pinduoduo|pdd/i, name: '拼多多' },
      { match: /jd\.com/i, name: '京东' },
      { match: /huawei/i, name: '华为' },
      { match: /xiaomi|mi\.com/i, name: '小米' },
      { match: /bilibili/i, name: '哔哩哔哩' },
      { match: /netease|163\.com/i, name: '网易' },
      { match: /didi/i, name: '滴滴' },
      { match: /oppo/i, name: 'OPPO' },
      { match: /vivo/i, name: 'vivo' },
      { match: /honor/i, name: '荣耀' },
      { match: /nio/i, name: '蔚来' },
      { match: /lixiang|liuto/i, name: '理想汽车' },
      { match: /xiaopeng|xpeng/i, name: '小鹏汽车' },
      { match: /byd/i, name: '比亚迪' },
      { match: /antgroup/i, name: '蚂蚁集团' },
      { match: /shopee/i, name: 'Shopee' },
      { match: /shein/i, name: 'SHEIN' },
      { match: /mihoyo/i, name: '米哈游' },
      { match: /cmbchina|cmb/i, name: '招商银行' },
      { match: /icbc/i, name: '工商银行' },
      { match: /ccb\.com/i, name: '建设银行' },
      { match: /boc\.cn/i, name: '中国银行' },
      { match: /abchina/i, name: '农业银行' },
      { match: /pingan/i, name: '中国平安' }
    ];

    for (const item of KNOWN_DOMAINS) {
      if (item.match.test(host)) return item.name;
    }

    const metaSite = document.querySelector('meta[property="og:site_name"]')?.content ||
                     document.querySelector('meta[name="author"]')?.content;
    if (metaSite && metaSite.length >= 2 && metaSite.length <= 25) return metaSite.trim();

    const title = document.title || '';
    const parts = title.split(/[-_|_|—|–|\/]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const companyPart = parts.find((p) => /公司|科技|集团|证券|银行|招聘|校园/i.test(p) && !/工程师|开发|产品|经理|专员|助理|实习生/i.test(p));
      if (companyPart) {
        return companyPart.replace(/校园招聘|校招|社会招聘|招聘官网|招聘|官方网站/g, '').trim() || companyPart;
      }
      return parts[parts.length - 1].replace(/校园招聘|校招|社会招聘|招聘官网|招聘/g, '').trim() || parts[0];
    }

    return parts[0] || host.replace(/^www\./, '').split('.')[0];
  }

  function detectPositionName() {
    const selectors = [
      'h1',
      '.job-name', '.job-title', '.position-name', '.position-title',
      '[class*="jobName"]', '[class*="jobTitle"]', '[class*="positionTitle"]',
      '.recruitment-title', '.job-header-title'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text.length >= 2 && text.length <= 40 && !/登录|注册|首页|网申|个人中心|校招首页/i.test(text)) {
          return text;
        }
      }
    }

    const title = document.title || '';
    const parts = title.split(/[-_|_|—|–|\/]/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (/工程师|开发|算法|产品|运营|设计|测试|管培|管培生|专员|经理|助理|分析师|研究员|架构师|实习生/i.test(part)) {
        return part.replace(/【.*?】|\[.*?\]/g, '').trim();
      }
    }

    return parts[0] || '网申岗位';
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

          console.log('[Capybara助手] 简历上传成功');
          input.style.backgroundColor = '#e8f5e9';
          input.style.border = '2px solid #4caf50';

        } catch (e) {
          console.error('[Capybara助手] 简历上传失败:', e);
        }
      }
    }
  }

  // ========================================================================
  // 悬浮按钮
  // ========================================================================

  function preferredTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyFloatTheme(theme) {
    const mode = theme === 'light' ? 'light' : 'dark';
    ['job-autofill-dock', 'job-autofill-float-btn', 'job-autofill-log-toggle', 'job-autofill-log-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('data-theme', mode);
    });
  }

  function escapeLogText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPageLogs(logs) {
    const list = document.getElementById('job-autofill-log-list');
    const empty = document.getElementById('job-autofill-log-empty');
    if (!list) return;
    const rows = (logs || []).slice().reverse().slice(0, 200);
    if (!rows.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = rows.map((item) => {
      const time = String(item.time || '').replace('T', ' ').replace('Z', '').slice(11, 19);
      const detail = item.detail
        ? `<pre class="job-autofill-log-detail">${escapeLogText(item.detail)}</pre>`
        : '';
      return `<article class="job-autofill-log-item is-${escapeLogText(item.level || 'info')}">
        <div class="job-autofill-log-meta">
          <span>${escapeLogText(time)}</span>
          <span class="job-autofill-log-level">${escapeLogText(item.level || 'info')}</span>
        </div>
        <div class="job-autofill-log-msg">${escapeLogText(item.message || '')}</div>
        ${detail}
      </article>`;
    }).join('');
  }

  function toggleLogPanel(forceOpen) {
    const panel = document.getElementById('job-autofill-log-panel');
    if (!panel) return;
    const open = forceOpen === undefined ? panel.getAttribute('data-open') !== 'true' : !!forceOpen;
    panel.setAttribute('data-open', open ? 'true' : 'false');
    if (open) {
      chrome.storage.local.get('jobAutofillLogs', (res) => {
        renderPageLogs(res && res.jobAutofillLogs);
      });
    }
  }

  function createLogPanel(theme) {
    if (document.getElementById('job-autofill-log-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'job-autofill-log-panel';
    panel.setAttribute('data-theme', theme);
    panel.setAttribute('data-open', 'false');
    panel.innerHTML = `
      <div class="job-autofill-log-head">
        <strong>运行日志</strong>
        <div class="job-autofill-log-actions">
          <button type="button" id="job-autofill-log-clear">清空</button>
          <button type="button" id="job-autofill-log-close">收起</button>
        </div>
      </div>
      <div id="job-autofill-log-empty" class="job-autofill-log-empty">还没有记录。填充、解析、模型调用都会出现在这里。</div>
      <div id="job-autofill-log-list" class="job-autofill-log-list"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#job-autofill-log-close').addEventListener('click', () => toggleLogPanel(false));
    panel.querySelector('#job-autofill-log-clear').addEventListener('click', () => {
      if (typeof appLog !== 'undefined') appLog.clear().then(() => renderPageLogs([]));
      else chrome.storage.local.set({ jobAutofillLogs: [] }, () => renderPageLogs([]));
    });
  }

  function createFloatingButton() {
    if (document.getElementById('job-autofill-dock')) return;
    const theme = preferredTheme();

    const dock = document.createElement('div');
    dock.id = 'job-autofill-dock';
    dock.setAttribute('data-theme', theme);

    const floatBtn = document.createElement('div');
    floatBtn.id = 'job-autofill-float-btn';
    floatBtn.setAttribute('data-theme', theme);
    floatBtn.innerHTML = `
      <span class="float-dot"></span>
      <span class="float-btn-text">填充</span>
    `;

    const logBtn = document.createElement('div');
    logBtn.id = 'job-autofill-log-toggle';
    logBtn.setAttribute('data-theme', theme);
    logBtn.textContent = '日志';
    logBtn.title = '在当前网页查看运行日志';

    floatBtn.addEventListener('click', () => {
      if (typeof appLog !== 'undefined') appLog.click('content', 'ui.click', '页面悬浮填充');
      floatBtn.classList.add('is-busy');
      chrome.runtime.sendMessage({ action: 'getActiveProfile' }, (response) => {
        if (response && response.success && response.profile) {
          fillForm(response.profile).then(() => {
            floatBtn.classList.remove('is-busy');
            toggleLogPanel(true);
          }).catch((error) => {
            floatBtn.classList.remove('is-busy');
            showNotification(error.message || '填充失败', 'error');
            toggleLogPanel(true);
          });
        } else {
          floatBtn.classList.remove('is-busy');
          showNotification('请先配置资料', 'warning');
        }
      });
    });

    logBtn.addEventListener('click', () => {
      if (typeof appLog !== 'undefined') appLog.click('content', 'ui.click', '打开网页日志');
      toggleLogPanel();
    });

    dock.appendChild(floatBtn);
    dock.appendChild(logBtn);
    document.body.appendChild(dock);
    createLogPanel(theme);

    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      const saved = response && response.success ? response.settings?.uiTheme : '';
      applyFloatTheme(saved || theme);
    });
  }

  function showNotification(message, type = 'success') {
    const oldNotif = document.getElementById('job-autofill-notification');
    if (oldNotif) oldNotif.remove();

    const notification = document.createElement('div');
    notification.id = 'job-autofill-notification';
    notification.className = type;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // ========================================================================
  // 初始化
  // ========================================================================

  function init() {
    console.log('[Capybara助手] Content Script 已加载');

    setTimeout(createFloatingButton, 800);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.jobAutofillData) {
        const theme = changes.jobAutofillData.newValue?.settings?.uiTheme;
        if (theme) applyFloatTheme(theme);
      }
      if (changes.jobAutofillLogs) {
        renderPageLogs(changes.jobAutofillLogs.newValue || []);
      }
    });

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
