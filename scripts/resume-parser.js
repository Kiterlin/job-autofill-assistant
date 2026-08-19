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
    return `你是一位专业的简历信息提取专家，擅长从各种格式的简历中提取结构化信息。

【你的专业能力】
- 能够理解多种简历格式：纯文本、Markdown、LaTeX、HTML、表格等
- 能够识别中英文简历
- 能够处理不规范的格式
- 能够推断缺失的信息

【输入说明】
用户可能提供以下格式的简历：
1. 纯文本简历（从PDF/Word复制）
2. Markdown格式简历
3. LaTeX源码简历（\\documentclass、\\begin{document}等）
4. HTML格式简历
5. 表格格式数据
6. 混合格式

【任务】
从以下简历内容中提取结构化信息，并以JSON格式返回。

【简历内容】
${resumeText}

【输出要求】
请严格按照以下JSON格式输出（不要包含任何其他文字，只返回JSON）：

{
  "basicInfo": {
    "fullName": "完整姓名",
    "firstName": "名",
    "lastName": "姓",
    "phone": "手机号（统一格式，如：13800138000）",
    "email": "邮箱",
    "gender": "性别（男/女，如果无法判断则留空）",
    "birthDate": "出生日期（YYYY-MM-DD格式）",
    "city": "城市",
    "state": "省份/州",
    "linkedin": "LinkedIn链接",
    "github": "GitHub链接",
    "website": "个人网站"
  },
  "education": [
    {
      "school": "学校名称",
      "major": "专业",
      "degree": "学历（本科/硕士/博士/大专）",
      "startDate": "开始时间（YYYY-MM格式）",
      "endDate": "结束时间（YYYY-MM格式，在读则填'至今'）",
      "gpa": "GPA（如3.8/4.0）"
    }
  ],
  "workExperience": [
    {
      "company": "公司名称",
      "position": "职位",
      "startDate": "开始时间（YYYY-MM格式）",
      "endDate": "结束时间（YYYY-MM格式，在职则填'至今'）",
      "description": "工作描述（简短总结，2-3句话）"
    }
  ],
  "projects": [
    {
      "name": "项目名称",
      "role": "担任角色",
      "description": "项目描述（简短总结）",
      "technologies": ["技术1", "技术2", "技术3"]
    }
  ],
  "skills": ["技能1", "技能2", "技能3", "技能4", "技能5"]
}

【特殊处理规则】
1. LaTeX格式：
   - 忽略\\documentclass、\\usepackage等命令
   - 从\\section、\\subsection提取章节标题
   - 从内容提取实际信息
   - \\textbf{}中通常是标题或重点
   - \\href{}中是链接

2. 日期格式：
   - "2019.09 - 2023.06" → startDate: "2019-09", endDate: "2023-06"
   - "2019年9月 - 2023年6月" → 同上
   - "2019/09 - 至今" → startDate: "2019-09", endDate: "至今"

3. 学历映射：
   - Bachelor/本科/学士 → "本科"
   - Master/硕士/研究生 → "硕士"
   - PhD/Doctor/博士 → "博士"
   - College/大专/专科 → "大专"

4. 技能提取：
   - 编程语言、框架、工具都算技能
   - 去重，只保留独特的技能

5. 信息推断：
   - 如果无法确定某个字段，使用空字符串""
   - 数组至少包含一个对象（即使是空对象）
   - 电话号码统一去除空格和连字符

【重要】
- 只返回JSON，不要包含任何解释性文字
- 确保JSON格式正确，可以被解析
- 所有字段都要存在，即使值为空

现在开始提取，直接返回JSON：`;
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
    try {
      // 移除可能的markdown代码块标记
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.substring(7);
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.substring(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.substring(0, jsonStr.length - 3);
      }

      jsonStr = jsonStr.trim();

      // 解析JSON
      const parsed = JSON.parse(jsonStr);

      // 验证和清理数据
      return this.validateAndCleanData(parsed);
    } catch (error) {
      console.error('[简历解析] JSON解析失败:', error);
      console.error('[简历解析] 原始内容:', content);
      throw new Error('AI返回的数据格式不正确，请重试');
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
