// ============================================================================
// 简历解析模块 - 使用AI提取PDF/Word简历信息
// ============================================================================

class ResumeParser {
  constructor() {
    this.supportedFormats = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
  }

  // 检查文件格式
  isSupported(file) {
    return this.supportedFormats.includes(file.type);
  }

  // 提取PDF文本（简化版，不依赖pdf.js）
  async extractPDFText(file) {
    // 由于Chrome扩展中加载pdf.js比较复杂，我们简化处理：
    // 直接告诉用户将PDF转换为文本，或者使用AI的文件上传功能
    throw new Error('PDF文本提取需要额外库支持。建议：\n1. 将PDF转换为Word格式后上传\n2. 手动复制简历内容');
  }

  // 提取Word文本（简化版，不依赖mammoth.js）
  async extractWordText(file) {
    throw new Error('Word文本提取需要额外库支持。建议：\n1. 将Word另存为PDF\n2. 手动复制简历内容');
  }

  // 提取简历文本
  async extractText(file) {
    if (file.type === 'application/pdf') {
      return await this.extractPDFText(file);
    } else if (file.type.includes('word')) {
      return await this.extractWordText(file);
    } else {
      throw new Error('不支持的文件格式');
    }
  }

  // 使用AI解析简历文本
  async parseWithAI(resumeText, settings) {
    if (!settings.aiEnabled || !settings.aiApiKey) {
      throw new Error('请先在设置中配置AI API Key');
    }

    const prompt = this.buildPrompt(resumeText);

    // 根据不同的AI提供商调用API
    switch (settings.aiProvider) {
      case 'deepseek':
        return await this.callDeepSeekAPI(prompt, settings);
      case 'qwen':
        return await this.callQwenAPI(prompt, settings);
      case 'kimi':
        return await this.callKimiAPI(prompt, settings);
      case 'glm':
        return await this.callGLMAPI(prompt, settings);
      case 'doubao':
        return await this.callDoubaoAPI(prompt, settings);
      case 'openai':
        return await this.callOpenAIAPI(prompt, settings);
      case 'gemini':
        return await this.callGeminiAPI(prompt, settings);
      default:
        throw new Error('未知的AI提供商');
    }
  }

  // 构建提示词
  buildPrompt(resumeText) {
    return `你是一位专业的简历信息提取专家。

【重要】你必须严格按照JSON格式返回，不要添加任何解释文字！

【任务】
从以下简历内容中提取结构化信息。

【简历内容】
${resumeText}

【输出格式】
请直接返回以下JSON格式（不要包含markdown代码块标记，不要添加任何说明文字）：

{
  "basicInfo": {
    "fullName": "完整姓名",
    "firstName": "名",
    "lastName": "姓",
    "phone": "手机号（只保留数字，如13800138000）",
    "email": "邮箱",
    "gender": "性别（男/女，不确定留空）",
    "birthDate": "出生日期（YYYY-MM-DD）",
    "city": "城市",
    "state": "省份",
    "linkedin": "LinkedIn链接",
    "github": "GitHub链接",
    "website": "个人网站"
  },
  "education": [
    {
      "school": "学校名称",
      "major": "专业",
      "degree": "学历（本科/硕士/博士）",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM或至今",
      "gpa": "GPA"
    }
  ],
  "workExperience": [
    {
      "company": "公司名称",
      "position": "职位",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM或至今",
      "description": "工作描述（简短总结）"
    }
  ],
  "projects": [
    {
      "name": "项目名称",
      "role": "角色",
      "description": "项目描述",
      "technologies": ["技术1", "技术2"]
    }
  ],
  "skills": ["技能1", "技能2", "技能3"]
}

【处理规则】
1. 电话号码：(+86) 138-1234-5678 → 13812345678
2. 日期：2023.09 - 2026.06 → startDate: "2023-09", endDate: "2026-06"
3. 学历：硕士/Master/研究生 → "硕士"，本科/Bachelor/学士 → "本科"
4. 如果字段没有信息，使用空字符串""
5. 数组字段至少包含一个对象

【再次强调】
只返回上面的JSON格式，不要添加任何其他文字！不要用markdown代码块包裹！直接返回纯JSON！

现在开始提取：`;
  }

  // 调用DeepSeek API
  async callDeepSeekAPI(prompt, settings) {
    const url = settings.aiApiUrl || 'https://api.deepseek.com/v1/chat/completions';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.aiApiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `DeepSeek API错误 (${response.status})`;

        try {
          const errorData = JSON.parse(errorText);
          errorMsg += `: ${errorData.error?.message || errorData.message || errorText}`;
        } catch {
          errorMsg += `: ${errorText}`;
        }

        console.error('[DeepSeek API] 错误详情:', errorText);
        throw new Error(errorMsg);
      }

      const data = await response.json();

      if (!data.choices || !data.choices[0]) {
        throw new Error('DeepSeek返回数据格式错误');
      }

      const content = data.choices[0].message.content;
      return this.parseAIResponse(content);
    } catch (error) {
      if (error.message.includes('API错误')) {
        throw error;
      }
      throw new Error(`DeepSeek连接失败: ${error.message}`);
    }
  }

  // 调用OpenAI API
  async callOpenAIAPI(prompt, settings) {
    const url = settings.aiApiUrl || 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.aiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API错误: ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    return this.parseAIResponse(content);
  }

  // 调用通义千问 Qwen API
  async callQwenAPI(prompt, settings) {
    const url = settings.aiApiUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.aiApiKey}`
      },
      body: JSON.stringify({
        model: 'qwen-plus',  // 或 qwen-turbo, qwen-max
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`通义千问 API错误: ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return this.parseAIResponse(content);
  }

  // 调用 Kimi API
  async callKimiAPI(prompt, settings) {
    const url = settings.aiApiUrl || 'https://api.moonshot.cn/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.aiApiKey}`
      },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',  // 或 moonshot-v1-32k, moonshot-v1-128k
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kimi API错误: ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return this.parseAIResponse(content);
  }

  // 调用智谱 GLM API
  async callGLMAPI(prompt, settings) {
    const url = settings.aiApiUrl || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.aiApiKey}`
      },
      body: JSON.stringify({
        model: 'glm-4-flash',  // 或 glm-4, glm-4-plus
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`智谱GLM API错误: ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return this.parseAIResponse(content);
  }

  // 调用豆包 API
  async callDoubaoAPI(prompt, settings) {
    const url = settings.aiApiUrl || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.aiApiKey}`
      },
      body: JSON.stringify({
        model: 'doubao-pro-32k',  // 需要替换为实际的endpoint_id
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`豆包 API错误: ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return this.parseAIResponse(content);
  }

  // 调用Gemini API
  async callGeminiAPI(prompt, settings) {
    const url = settings.aiApiUrl || `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${settings.aiApiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API错误: ${error}`);
    }

    const data = await response.json();
    const content = data.candidates[0].content.parts[0].text;

    return this.parseAIResponse(content);
  }

  // 解析AI返回的JSON
  parseAIResponse(content) {
    console.log('[简历解析] 开始解析AI响应');
    console.log('[简历解析] 原始内容长度:', content.length);
    console.log('[简历解析] 原始内容前200字符:', content.substring(0, 200));

    try {
      // 移除可能的markdown代码块标记
      let jsonStr = content.trim();

      if (jsonStr.startsWith('```json')) {
        console.log('[简历解析] 发现```json标记，移除');
        jsonStr = jsonStr.substring(7);
      } else if (jsonStr.startsWith('```')) {
        console.log('[简历解析] 发现```标记，移除');
        jsonStr = jsonStr.substring(3);
      }

      if (jsonStr.endsWith('```')) {
        console.log('[简历解析] 发现结尾```标记，移除');
        jsonStr = jsonStr.substring(0, jsonStr.length - 3);
      }

      jsonStr = jsonStr.trim();

      console.log('[简历解析] 清理后内容前200字符:', jsonStr.substring(0, 200));

      // 尝试查找JSON对象
      const jsonStart = jsonStr.indexOf('{');
      const jsonEnd = jsonStr.lastIndexOf('}');

      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
        console.log('[简历解析] 提取JSON对象，长度:', jsonStr.length);
      }

      // 解析JSON
      console.log('[简历解析] 尝试解析JSON...');
      const parsed = JSON.parse(jsonStr);
      console.log('[简历解析] JSON解析成功！');

      // 验证和清理数据
      const cleaned = this.validateAndCleanData(parsed);
      console.log('[简历解析] 数据验证完成');
      return cleaned;

    } catch (error) {
      console.error('[简历解析] JSON解析失败!');
      console.error('[简历解析] 错误:', error.message);
      console.error('[简历解析] AI完整响应:', content);

      throw new Error(`AI返回格式错误：${error.message}\n\n请查看控制台了解详情，或尝试：\n1. 简化简历内容\n2. 重新测试连接\n3. 切换其他AI提供商`);
    }
  }

  // 验证和清理数据
  validateAndCleanData(data) {
    const cleaned = {
      basicInfo: data.basicInfo || {},
      education: Array.isArray(data.education) ? data.education : [],
      workExperience: Array.isArray(data.workExperience) ? data.workExperience : [],
      projects: Array.isArray(data.projects) ? data.projects : [],
      skills: Array.isArray(data.skills) ? data.skills : []
    };

    // 确保至少有一个空的教育/工作/项目经历
    if (cleaned.education.length === 0) {
      cleaned.education.push({
        school: '', major: '', degree: '', startDate: '', endDate: '', gpa: ''
      });
    }
    if (cleaned.workExperience.length === 0) {
      cleaned.workExperience.push({
        company: '', position: '', startDate: '', endDate: '', description: ''
      });
    }
    if (cleaned.projects.length === 0) {
      cleaned.projects.push({
        name: '', role: '', description: '', technologies: []
      });
    }

    return cleaned;
  }

  // 简化版本：不使用AI，只提取文本
  async parseSimple(file) {
    // 返回一个提示，让用户知道需要配置AI
    return {
      error: 'AI_NOT_CONFIGURED',
      message: '简历已上传，但需要配置AI才能自动解析。请前往设置页面配置AI API Key。',
      fileName: file.name
    };
  }
}

// 导出单例
const resumeParser = new ResumeParser();
