// ============================================================================
// 数据存储管理模块 - 优化版
// 基于参考项目的最佳实践，增加错误处理和性能优化
// ============================================================================

class StorageManager {
  constructor() {
    this.storageKey = 'jobAutofillData';
    this.saveDebounceTimer = null;
    this.saveDebounceDelay = 500; // 防抖延迟500ms
  }

  // 获取默认空资料模板
  getEmptyProfile() {
    return {
      id: this.generateId(),
      name: '默认资料',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),

      // 基本信息
      basicInfo: {
        fullName: '',
        firstName: '',
        lastName: '',
        middleName: '',
        phone: '',
        phoneType: '', // Mobile, Home, Work
        email: '',
        gender: '',
        birthDate: '',
        idCard: '',

        // 背景与身份（国企/央企/体制内/大厂高频）
        politicalStatus: '', // 中共党员, 中共预备党员, 共青团员, 群众, 民主党派
        ethnicity: '',       // 民族 (如: 汉族)
        hometown: '',        // 籍贯 / 生源地 (如: 山东青岛)
        graduationDate: '',  // 毕业时间 (如: 2026-06)

        // 紧急联系人
        emergencyContact: '',
        emergencyPhone: '',
        emergencyRelation: '',

        // 地址信息
        address: '',      // 完整地址
        street: '',       // 街道
        city: '',         // 城市
        state: '',        // 省/州
        country: '',      // 国家
        zipCode: '',      // 邮编
        location: '',     // 简化地址

        // 社交链接
        linkedin: '',
        github: '',
        website: '',
        twitter: ''
      },

      // 求职意向与偏好
      jobIntention: {
        expectedCity: '',      // 期望城市 (如: 北京, 上海, 深圳)
        expectedPosition: '',  // 期望岗位 (如: 前端开发工程师)
        expectedSalary: '',    // 期望薪资
        availableDate: '',     // 到岗时间 (如: 随时到岗, 2026年7月)
        referralCode: ''       // 内推码 / 推荐人
      },

      // 语言能力与成绩
      languageSkills: {
        cet4: '',              // 英语四级 (如: 580 或 通过)
        cet6: '',              // 英语六级 (如: 560 或 通过)
        ielts: '',             // 雅思成绩 (如: 7.5)
        toefl: '',             // 托福成绩 (如: 105)
        otherLanguages: ''     // 其他外语 (如: 日语N1)
      },

      // 荣誉与竞赛奖励
      awards: [
        {
          id: this.generateId(),
          name: '',            // 奖项名称 (如: 国家奖学金)
          level: '',           // 获奖级别 (国家级, 省部级, 校级, 院系级)
          date: ''             // 获奖时间 (如: 2024-11)
        }
      ],

      // 教育经历（可动态添加）
      education: [
        {
          id: this.generateId(),
          school: '',          // 学校全称
          college: '',         // 学院/院系 (如: 计算机学院)
          major: '',           // 专业全称
          degree: '',          // 学历 (大专/本科/硕士/博士)
          degreeType: '',      // 培养方式 (普通全日制统招, 非全日制, 留学生)
          startDate: '',       // 入学时间
          endDate: '',         // 毕业时间
          gpa: '',             // GPA成绩 (如: 3.8/4.0)
          rank: '',            // 专业排名 (如: 前5%, 1/120)
          courses: '',         // 主修核心课程
          description: ''
        }
      ],

      // 工作/实习经历
      workExperience: [
        {
          id: this.generateId(),
          company: '',         // 公司全称
          department: '',      // 所属部门 / 业务线
          position: '',        // 职位名称
          workType: '',        // 工作性质 (实习, 正式, 兼职)
          city: '',            // 工作城市
          startDate: '',       // 开始时间
          endDate: '',         // 结束时间 (或至今)
          description: '',     // 工作职责 (STAR原则)
          achievements: ''     // 核心量化成果 / 业务产出
        }
      ],

      // 项目经历
      projects: [
        {
          id: this.generateId(),
          name: '',            // 项目名称
          role: '',            // 担任角色
          projectType: '',     // 项目类型 (商业项目, 科研课题, 竞赛项目, 开源项目)
          techStack: '',       // 技术栈 / 关键工具 (如: React, Go, Redis)
          startDate: '',       // 开始时间
          endDate: '',         // 结束时间
          projectUrl: '',      // 项目链接 / Demo
          description: '',     // 项目描述 / 背景
          responsibilities: '',// 个人职责与难点攻关
          achievements: ''     // 项目成果 / 产出量化
        }
      ],

      // 技能标签
      skills: [],

      // 证书
      certificates: [],

      // 自我介绍模板
      introTemplates: {
        default: '',
        custom: []
      },

      // HR沟通打招呼自荐语（BOSS/智联速聊）
      hrGreeting: '',

      // 简历文件（base64或URL）
      resumeFile: null,
      resumeFileName: ''
    };
  }

  // 生成唯一ID
  generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // 初始化存储（首次使用）
  async initialize() {
    try {
      const data = await this.loadAll();
      if (!data || !data.profiles || data.profiles.length === 0) {
        const defaultData = {
          version: '1.0.0', // 数据版本
          profiles: [this.getEmptyProfile()],
          activeProfileId: null,
          settings: {
            aiEnabled: false,
            aiProvider: 'deepseek',
            aiApiKey: '',
            aiApiUrl: '',
            aiModel: '',
            ocrApiKey: '',
            uiTheme: '',
            autoFillOnPageLoad: false,
            highlightFilledFields: true
          },
          createdAt: new Date().toISOString()
        };
        defaultData.activeProfileId = defaultData.profiles[0].id;
        await this.saveAll(defaultData);
        console.log('[存储] 初始化完成');
        return defaultData;
      }
      console.log('[存储] 加载现有数据');
      return data;
    } catch (error) {
      console.error('[存储] 初始化失败:', error);
      throw error;
    }
  }

  // 加载所有数据 - 增强错误处理
  async loadAll() {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(this.storageKey, (result) => {
          if (chrome.runtime.lastError) {
            console.error('[存储] 加载失败:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }

          const data = result[this.storageKey];

          // 数据校验
          if (data && this.validateData(data)) {
            console.log('[存储] 数据加载成功，大小:', JSON.stringify(data).length, '字节');
            resolve(data);
          } else if (data) {
            console.warn('[存储] 数据格式异常，尝试修复');
            const fixed = this.fixData(data);
            resolve(fixed);
          } else {
            resolve(null);
          }
        });
      } catch (error) {
        console.error('[存储] 加载异常:', error);
        reject(error);
      }
    });
  }

  // 保存所有数据 - 增强错误处理和容量检测
  async saveAll(data) {
    return new Promise((resolve, reject) => {
      try {
        // 添加更新时间戳
        data.updatedAt = new Date().toISOString();

        // 检查数据大小（Chrome限制5MB）
        const dataStr = JSON.stringify(data);
        const sizeInBytes = new Blob([dataStr]).size;
        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

        console.log(`[存储] 数据大小: ${sizeInMB}MB (${sizeInBytes} 字节)`);

        if (sizeInBytes > 5 * 1024 * 1024) {
          const error = new Error(`数据过大(${sizeInMB}MB)，超过5MB限制。请删除部分资料或简历文件。`);
          console.error('[存储]', error.message);
          reject(error);
          return;
        }

        if (sizeInBytes > 4 * 1024 * 1024) {
          console.warn(`[存储] 警告: 数据接近上限(${sizeInMB}MB/5MB)`);
        }

        chrome.storage.local.set({ [this.storageKey]: data }, () => {
          if (chrome.runtime.lastError) {
            console.error('[存储] 保存失败:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }
          console.log('[存储] 保存成功');
          resolve();
        });
      } catch (error) {
        console.error('[存储] 保存异常:', error);
        reject(error);
      }
    });
  }

  // 防抖保存 - 避免频繁写入
  async saveAllDebounced(data) {
    return new Promise((resolve, reject) => {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = setTimeout(async () => {
        try {
          await this.saveAll(data);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, this.saveDebounceDelay);
    });
  }

  // 数据验证
  validateData(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.profiles)) return false;
    if (!data.settings || typeof data.settings !== 'object') return false;
    return true;
  }

  // 数据修复
  fixData(data) {
    console.log('[存储] 执行数据修复');
    if (!data.profiles) data.profiles = [];
    if (!data.settings) data.settings = {};
    if (!data.activeProfileId && data.profiles.length > 0) {
      data.activeProfileId = data.profiles[0].id;
    }
    return data;
  }

  // 获取当前激活的资料
  async getActiveProfile() {
    try {
      const data = await this.loadAll();
      if (!data || !data.activeProfileId) return null;
      const profile = data.profiles.find(p => p.id === data.activeProfileId);
      if (!profile) {
        console.warn('[存储] 未找到激活的资料，使用第一个');
        return data.profiles[0] || null;
      }
      return profile;
    } catch (error) {
      console.error('[存储] 获取激活资料失败:', error);
      return null;
    }
  }

  // 获取所有资料列表
  async getAllProfiles() {
    try {
      const data = await this.loadAll();
      return data?.profiles || [];
    } catch (error) {
      console.error('[存储] 获取资料列表失败:', error);
      return [];
    }
  }

  // 添加新资料
  async addProfile(name = '新资料') {
    try {
      const data = await this.loadAll();
      const newProfile = this.getEmptyProfile();
      newProfile.name = name;
      data.profiles.push(newProfile);
      await this.saveAll(data);
      console.log('[存储] 新增资料:', name);
      return newProfile.id;
    } catch (error) {
      console.error('[存储] 添加资料失败:', error);
      throw error;
    }
  }

  // 更新资料
  async updateProfile(profileId, updates) {
    try {
      const data = await this.loadAll();
      const index = data.profiles.findIndex(p => p.id === profileId);
      if (index !== -1) {
        updates.updatedAt = new Date().toISOString();
        data.profiles[index] = { ...data.profiles[index], ...updates };
        await this.saveAll(data);
        console.log('[存储] 更新资料:', profileId);
        return true;
      }
      console.warn('[存储] 未找到资料:', profileId);
      return false;
    } catch (error) {
      console.error('[存储] 更新资料失败:', error);
      throw error;
    }
  }

  // 删除资料
  async deleteProfile(profileId) {
    try {
      const data = await this.loadAll();
      if (data.profiles.length <= 1) {
        console.warn('[存储] 至少保留一份资料');
        return false;
      }
      data.profiles = data.profiles.filter(p => p.id !== profileId);
      if (data.activeProfileId === profileId) {
        data.activeProfileId = data.profiles[0].id;
      }
      await this.saveAll(data);
      console.log('[存储] 删除资料:', profileId);
      return true;
    } catch (error) {
      console.error('[存储] 删除资料失败:', error);
      throw error;
    }
  }

  // 切换激活资料
  async setActiveProfile(profileId) {
    try {
      const data = await this.loadAll();
      if (data.profiles.find(p => p.id === profileId)) {
        data.activeProfileId = profileId;
        await this.saveAll(data);
        console.log('[存储] 切换资料:', profileId);
        return true;
      }
      console.warn('[存储] 资料不存在:', profileId);
      return false;
    } catch (error) {
      console.error('[存储] 切换资料失败:', error);
      throw error;
    }
  }

  // 获取设置
  async getSettings() {
    try {
      const data = await this.loadAll();
      return data?.settings || {};
    } catch (error) {
      console.error('[存储] 获取设置失败:', error);
      return {};
    }
  }

  // 更新设置
  async updateSettings(updates) {
    try {
      const data = await this.loadAll();
      data.settings = { ...data.settings, ...updates };
      await this.saveAll(data);
      console.log('[存储] 更新设置');
    } catch (error) {
      console.error('[存储] 更新设置失败:', error);
      throw error;
    }
  }

  // 添加教育经历
  async addEducation(profileId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.education.push({
          id: this.generateId(),
          school: '',
          major: '',
          degree: '',
          startDate: '',
          endDate: '',
          gpa: '',
          rank: '',
          description: ''
        });
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 添加教育经历失败:', error);
      throw error;
    }
  }

  // 删除教育经历
  async deleteEducation(profileId, eduId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.education = profile.education.filter(e => e.id !== eduId);
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 删除教育经历失败:', error);
      throw error;
    }
  }

  // 添加工作经历
  async addWorkExperience(profileId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.workExperience.push({
          id: this.generateId(),
          company: '',
          position: '',
          startDate: '',
          endDate: '',
          description: ''
        });
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 添加工作经历失败:', error);
      throw error;
    }
  }

  // 删除工作经历
  async deleteWorkExperience(profileId, workId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.workExperience = profile.workExperience.filter(w => w.id !== workId);
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 删除工作经历失败:', error);
      throw error;
    }
  }

  // 添加项目经历
  async addProject(profileId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.projects.push({
          id: this.generateId(),
          name: '',
          role: '',
          startDate: '',
          endDate: '',
          technologies: [],
          description: '',
          achievements: ''
        });
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 添加项目经历失败:', error);
      throw error;
    }
  }

  // 删除项目经历
  async deleteProject(profileId, projectId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.projects = profile.projects.filter(p => p.id !== projectId);
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 删除项目经历失败:', error);
      throw error;
    }
  }

  // ============================================================================
  // 投递历史记录管理
  // ============================================================================

  // 获取所有投递记录
  async getSubmissions() {
    try {
      const data = await this.loadAll();
      return Array.isArray(data?.submissions) ? data.submissions : [];
    } catch (error) {
      console.error('[存储] 获取投递记录失败:', error);
      return [];
    }
  }

  // 记录投递（新增或自动更新同一天同网址/岗位的记录）
  async addSubmission(submissionData) {
    try {
      const data = await this.loadAll();
      if (!Array.isArray(data.submissions)) {
        data.submissions = [];
      }

      const today = new Date().toISOString().slice(0, 10);
      const url = String(submissionData.url || '').trim();
      const company = String(submissionData.company || '未知企业').trim();
      const position = String(submissionData.position || '网申岗位').trim();
      const profileName = String(submissionData.profileName || '默认资料').trim();
      const profileId = submissionData.profileId || data.activeProfileId || '';
      const status = submissionData.status || '在投';
      const date = submissionData.date || today;
      const notes = submissionData.notes || '';

      // 查重：仅当公司名称与岗位名称完全一致且在同一天时才更新，确保同一公司的不同岗位能够各自独立记录在看板上
      const existingIndex = data.submissions.findIndex((s) => {
        const sameCompany = s.company && company && s.company.toLowerCase().trim() === company.toLowerCase().trim();
        const samePosition = s.position && position && s.position.toLowerCase().trim() === position.toLowerCase().trim();
        return sameCompany && samePosition && s.date === date;
      });

      if (existingIndex !== -1) {
        data.submissions[existingIndex] = {
          ...data.submissions[existingIndex],
          company,
          position,
          url: url || data.submissions[existingIndex].url,
          profileName,
          profileId,
          status: data.submissions[existingIndex].status || status,
          updatedAt: new Date().toISOString()
        };
        await this.saveAll(data);
        console.log('[存储] 更新同公司同岗位投递记录:', company, position);
        return data.submissions[existingIndex];
      }

      const newRecord = {
        id: this.generateId(),
        company,
        position,
        url,
        date,
        profileName,
        profileId,
        status, // 在投 / 笔试 / 面试 / 挂了 / Offer
        notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 最新投递排在最前面
      data.submissions.unshift(newRecord);
      await this.saveAll(data);
      console.log('[存储] 新增投递记录:', company, position);
      return newRecord;
    } catch (error) {
      console.error('[存储] 保存投递记录失败:', error);
      throw error;
    }
  }

  // 修改投递记录（用户手动调整进度、公司、岗位等）
  async updateSubmission(submissionId, updates) {
    try {
      const data = await this.loadAll();
      if (!Array.isArray(data.submissions)) return false;

      const index = data.submissions.findIndex((s) => s.id === submissionId);
      if (index !== -1) {
        data.submissions[index] = {
          ...data.submissions[index],
          ...updates,
          updatedAt: new Date().toISOString()
        };
        await this.saveAll(data);
        console.log('[存储] 修改投递记录:', submissionId);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 更新投递记录失败:', error);
      throw error;
    }
  }

  // 删除单条投递记录
  async deleteSubmission(submissionId) {
    try {
      const data = await this.loadAll();
      if (!Array.isArray(data.submissions)) return false;

      data.submissions = data.submissions.filter((s) => s.id !== submissionId);
      await this.saveAll(data);
      console.log('[存储] 删除投递记录:', submissionId);
      return true;
    } catch (error) {
      console.error('[存储] 删除投递记录失败:', error);
      throw error;
    }
  }

  // 导出数据（备份）
  async exportData() {
    try {
      const data = await this.loadAll();
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error('[存储] 导出数据失败:', error);
      throw error;
    }
  }

  // 导入数据（恢复）
  async importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!this.validateData(data)) {
        throw new Error('数据格式不正确');
      }
      await this.saveAll(data);
      console.log('[存储] 导入数据成功');
      return true;
    } catch (error) {
      console.error('[存储] 导入数据失败:', error);
      throw error;
    }
  }

  // 清空所有数据（危险操作）
  async clearAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(this.storageKey, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('[存储] 清空所有数据');
          resolve();
        }
      });
    });
  }

  // 获取存储使用情况
  async getStorageInfo() {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(this.storageKey, (bytes) => {
        const sizeInMB = (bytes / (1024 * 1024)).toFixed(2);
        const percentUsed = ((bytes / (5 * 1024 * 1024)) * 100).toFixed(1);
        resolve({
          bytes,
          sizeInMB,
          percentUsed,
          limit: '5MB'
        });
      });
    });
  }
}

// 导出单例
const storageManager = new StorageManager();
