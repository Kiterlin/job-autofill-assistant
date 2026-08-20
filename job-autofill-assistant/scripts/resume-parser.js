// ============================================================================
// 简历智能解析与 HR 打招呼语生成模块
// 支持 DeepSeek, 通义千问, 智谱GLM, Kimi, 豆包, 硅基流动, OpenAI, Gemini 等模型
// ============================================================================

const AI_PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    url: 'https://api.deepseek.com/v1/chat/completions',
    modelsUrl: 'https://api.deepseek.com/v1/models',
    defaultModel: 'deepseek-chat',
    jsonMode: true
  },
  qwen: {
    label: '通义千问',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    modelsUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    defaultModel: 'qwen-plus',
    jsonMode: true
  },
  glm: {
    label: '智谱 GLM',
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    modelsUrl: 'https://open.bigmodel.cn/api/paas/v4/models',
    defaultModel: 'glm-4-plus',
    jsonMode: true
  },
  kimi: {
    label: 'Moonshot Kimi',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    modelsUrl: 'https://api.moonshot.cn/v1/models',
    defaultModel: 'moonshot-v1-8k',
    jsonMode: true
  },
  doubao: {
    label: '火山引擎 豆包',
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    modelsUrl: 'https://ark.cn-beijing.volces.com/api/v3/models',
    defaultModel: '',
    jsonMode: true
  },
  siliconflow: {
    label: '硅基流动',
    url: 'https://api.siliconflow.cn/v1/chat/completions',
    modelsUrl: 'https://api.siliconflow.cn/v1/models',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    jsonMode: true
  },
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    modelsUrl: 'https://api.openai.com/v1/models',
    defaultModel: 'gpt-4o-mini',
    jsonMode: true
  },
  gemini: {
    label: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    defaultModel: 'gemini-1.5-flash',
    gemini: true,
    jsonMode: true
  }
};

function emitLog(level, event, message, detail) {
  try {
    if (typeof appLog !== 'undefined' && appLog.append) {
      appLog.append({ level, source: 'parser', event, message, detail });
    }
  } catch {
    // ignore
  }
}

class ResumeParser {
  constructor() {
    this.initPdfWorker();
  }

  initPdfWorker() {
    try {
      if (typeof pdfjsLib !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.js');
      }
    } catch (e) {
      console.warn('[简历解析] 无法设置 PDF worker:', e);
    }
  }

  isSupported(file) {
    const name = (file.name || '').toLowerCase();
    const type = file.type || '';
    return (
      type === 'application/pdf' ||
      type === 'application/msword' ||
      type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      type.startsWith('text/') ||
      type.startsWith('image/') ||
      /\.(pdf|docx|doc|txt|md|tex|latex|html|htm|png|jpe?g|webp|gif|bmp)$/i.test(name)
    );
  }

  async extractText(file) {
    const name = (file.name || '').toLowerCase();
    const type = file.type || '';

    if (type.startsWith('text/') || /\.(txt|md|tex|latex|html|htm)$/i.test(name)) {
      return await this.readTextFile(file);
    }
    if (name.endsWith('.docx') || type.includes('wordprocessingml')) {
      return await this.extractDocxText(file);
    }
    if (name.endsWith('.pdf') || type === 'application/pdf') {
      return await this.extractPDFText(file);
    }
    if (name.endsWith('.doc') || type === 'application/msword') {
      throw new Error('暂不支持旧版 .doc 格式，请在 Word 中另存为 .docx 或 PDF 后上传');
    }
    if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) {
      throw new Error('图片简历需要 OCR 或支持视觉的模型。请配置硅基流动 OCR，或改用 Gemini 等可直接读图的模型');
    }
    throw new Error('不支持的文件格式，请使用 PDF / Word / 图片 / TXT / Markdown');
  }

  async readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(String(e.target.result || ''));
      reader.onerror = (e) => reject(new Error('读取文本文件失败'));
      reader.readAsText(file, 'utf-8');
    });
  }

  async extractDocxText(file) {
    const xmlBytes = (await readZipEntries(await file.arrayBuffer()))['word/document.xml'];
    if (!xmlBytes) throw new Error('无效的 Word 文件');
    const xml = new TextDecoder('utf-8').decode(xmlBytes);
    const text = xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^/]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) throw new Error('Word 文件中没有可提取的文字');
    return text;
  }

  async extractPDFText(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF 解析库未加载，请重新加载插件或直接粘贴文本');
    }
    this.initPdfWorker();
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(' ');
      pages.push(pageText);
    }
    const text = pages.join('\n\n').trim();
    if (!text) {
      throw new Error('未能从 PDF 中提取出文字，可能是扫描版图片 PDF，建议直接粘贴文字');
    }
    return text;
  }

  getProvider(settings) {
    const providerId = settings.aiProvider || 'deepseek';
    const base = AI_PROVIDERS[providerId] || AI_PROVIDERS.deepseek;
    return {
      ...base,
      url: settings.aiApiUrl ? settings.aiApiUrl.trim() : base.url,
      modelsUrl: settings.aiApiUrl ? this.toModelsUrl(settings.aiApiUrl, providerId) : base.modelsUrl,
      model: settings.aiModel || base.defaultModel
    };
  }

  toModelsUrl(customUrl, providerId) {
    try {
      const url = new URL(customUrl);
      if (url.pathname.includes('/chat/completions')) {
        url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
      } else if (!url.pathname.endsWith('/models')) {
        url.pathname = url.pathname.replace(/\/+$/, '') + '/models';
      }
      return url.toString();
    } catch {
      return (AI_PROVIDERS[providerId] || AI_PROVIDERS.deepseek).modelsUrl;
    }
  }

  async listModels(settings) {
    if (!settings.aiApiKey) {
      throw new Error('请先填写 API Key');
    }
    const provider = this.getProvider(settings);
    if (settings.aiProvider === 'doubao') {
      return ['请直接填入火山方舟推理接入点 Endpoint ID (ep-...)'];
    }

    try {
      if (provider.gemini) {
        const url = `${provider.modelsUrl}?key=${encodeURIComponent(settings.aiApiKey)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const names = (data.models || [])
          .map((m) => (m.name || '').replace(/^models\//, ''))
          .filter((name) => /gemini/i.test(name));
        emitLog('success', 'model.list', `拉取到 ${names.length} 个可用模型`, names.slice(0, 30));
        return names;
      }

      const res = await fetch(provider.modelsUrl, {
        headers: { Authorization: `Bearer ${settings.aiApiKey}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.data || []);
      let names = list.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
      if (settings.aiProvider === 'siliconflow') {
        names = names.filter((id) => !/embedding|rerank|tts|wav2vec|stable-diffusion|flux|kolors|hunyuan-dit|video|ocr/i.test(id));
      }
      emitLog('success', 'model.list', `拉取到 ${names.length} 个可用模型`, names.slice(0, 30));
      return names;
    } catch (e) {
      console.warn('[获取模型] 自动拉取失败:', e.message);
      emitLog('error', 'model.list', '拉取模型列表失败', e.message);
      throw new Error(e.message || '获取模型列表失败');
    }
  }

  async testConnection(settings) {
    if (!settings.aiApiKey) {
      throw new Error('请先填写 API Key');
    }
    const messages = [{ role: 'user', content: '请仅回复两个字：收到' }];
    emitLog('info', 'model.test', `测试连接：${settings.aiProvider} / ${settings.aiModel}`);
    try {
      const reply = await this.chat(settings, messages);
      emitLog('success', 'model.test', '测试连接成功', { preview: String(reply || '').slice(0, 80) });
      return { model: settings.aiModel, preview: reply.slice(0, 100) };
    } catch (error) {
      emitLog('error', 'model.test', '测试连接失败', error.message);
      throw error;
    }
  }

  async chat(settings, messages, options = {}) {
    const provider = this.getProvider(settings);
    if (provider.gemini) {
      return await this.callGemini(settings, provider, messages, options);
    }
    return await this.callOpenAICompatible(settings, provider, messages, options);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isBusyError(error) {
    const msg = String(error && error.message ? error.message : error);
    return /503|429|UNAVAILABLE|high demand|RESOURCE_EXHAUSTED|过于频繁|繁忙|限流|Failed to fetch|fetch/i.test(msg);
  }

  formatApiError(label, status, body) {
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error?.message || parsed.message || body;
    } catch {
      // keep raw
    }
    if (status === 503 || /UNAVAILABLE|high demand/i.test(detail)) {
      return `${label} 当前繁忙（服务拥挤），请等十几秒再试，或换 DeepSeek / 通义千问`;
    }
    if (status === 429 || /RESOURCE_EXHAUSTED|rate/i.test(detail)) {
      return `${label} 请求过于频繁，请稍后再试`;
    }
    return `${label} API 错误 (${status}): ${detail}`;
  }

  async fetchJsonRetry(url, init, label) {
    const maxAttempts = 3;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      const safeUrl = typeof appLogSafeUrl === 'function' ? appLogSafeUrl(url) : String(url).split('?')[0];
      emitLog('info', 'model.request', `${label} 请求开始（第 ${attempt}/${maxAttempts} 次）`, { url: safeUrl });
      try {
        const response = await fetch(url, init);
        const text = await response.text();
        const ms = Date.now() - started;
        if (response.ok) {
          try {
            const data = JSON.parse(text);
            emitLog('success', 'model.success', `${label} 请求成功（${ms}ms）`, { url: safeUrl, status: response.status, bytes: text.length });
            return data;
          } catch {
            throw new Error(`${label} 返回的不是 JSON`);
          }
        }
        const err = new Error(this.formatApiError(label, response.status, text));
        lastError = err;
        emitLog('warn', 'model.http', `${label} HTTP ${response.status}（${ms}ms）`, { url: safeUrl, body: text.slice(0, 500) });
        if (!this.isBusyError(err) || attempt === maxAttempts) throw err;
        console.warn(`[${label}] ${response.status}，${attempt}/${maxAttempts} 次，稍后重试`);
      } catch (error) {
        if (error && error.name === 'TypeError' && /fetch/i.test(error.message || '')) {
          lastError = new Error(`${label} 网络中断或请求被浏览器限流，请等待几秒再试，不要连续点击`);
        } else {
          lastError = error;
        }
        emitLog('error', 'model.fail', `${label} 请求失败（第 ${attempt} 次）`, lastError.message);
        if (!this.isBusyError(lastError) || attempt === maxAttempts) throw lastError;
        console.warn(`[${label}] 请求失败，${attempt}/${maxAttempts} 次，稍后重试:`, lastError.message);
      }
      await this.sleep(1500 * Math.pow(2, attempt - 1));
    }
    throw lastError || new Error(`${label} 请求失败`);
  }

  async callOpenAICompatible(settings, provider, messages, options = {}) {
    const body = {
      model: provider.model,
      messages,
      temperature: options.temperature ?? 0.1
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.jsonMode && provider.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const data = await this.fetchJsonRetry(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.aiApiKey}`
      },
      body: JSON.stringify(body)
    }, provider.label);

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error(`${provider.label} 返回数据格式异常`);
    }
    return data.choices[0].message.content;
  }

  async callGemini(settings, provider, messages, options = {}) {
    const model = (provider.model || 'gemini-1.5-flash').replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.aiApiKey)}`;

    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : '' }]
    })).filter((item) => item.parts[0].text);

    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const userContents = messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));

    const body = {
      contents: userContents.length ? userContents : contents,
      generationConfig: {
        temperature: options.temperature ?? 0.1
      }
    };
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] };
    }
    if (options.maxTokens) body.generationConfig.maxOutputTokens = options.maxTokens;
    if (options.jsonMode) body.generationConfig.responseMimeType = 'application/json';

    const data = await this.fetchJsonRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 'Gemini');
    return this.extractGeminiText(data);
  }

  extractGeminiText(data) {
    const candidate = data && data.candidates && data.candidates[0];
    const parts = (candidate && candidate.content && candidate.content.parts) || [];
    const text = parts.filter((part) => part && part.text && !part.thought).map((part) => part.text).join('');
    if (text.trim()) return text;
    const finish = (candidate && candidate.finishReason) || '';
    const block = data && data.promptFeedback && data.promptFeedback.blockReason;
    if (finish === 'MAX_TOKENS') throw new Error('Gemini 输出被截断，请换一个模型或缩短简历后再试');
    if (finish === 'SAFETY' || block) throw new Error(`Gemini 安全策略拦截${block ? '：' + block : ''}`);
    if (!candidate) throw new Error('Gemini 没有返回候选结果');
    throw new Error('Gemini 未返回文本内容');
  }

  guessMime(fileName) {
    const name = String(fileName || '').toLowerCase();
    if (name.endsWith('.pdf')) return 'application/pdf';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.bmp')) return 'image/bmp';
    if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return '';
  }

  isImageFile(file) {
    const mime = file.type || this.guessMime(file.name);
    return /^image\//.test(mime) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '');
  }

  isPdfFile(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  }

  notifyProgress(onProgress, stage, message) {
    if (typeof onProgress === 'function') onProgress({ stage, message });
    emitLog('info', 'parse.stage.' + stage, message);
  }

  async fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  canSendFileDirect(settings, file) {
    const model = String(settings.aiModel || '').toLowerCase();
    const provider = settings.aiProvider;
    if (provider === 'gemini' && (this.isPdfFile(file) || this.isImageFile(file))) return true;
    if (this.isImageFile(file) && /(gpt-4o|gpt-4\.1|gpt-5|vision|vl-|qwen-vl|qwen2-vl|qwen2\.5-vl|glm-4v|internvl|gemini)/i.test(model)) {
      return true;
    }
    return false;
  }

  async parseDirectFile(file, settings) {
    const mime = file.type || this.guessMime(file.name) || 'application/octet-stream';
    const base64 = await this.fileToBase64(file);
    const prompt = this.buildPrompt('附件即为简历原件。请直接阅读文件内容后提取，不要说无法查看文件。');
    const provider = this.getProvider(settings);

    if (provider.gemini) {
      const model = (provider.model || 'gemini-1.5-flash').replace(/^models\//, '');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.aiApiKey)}`;
      const body = {
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mime, data: base64 } },
            { text: prompt }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      };
      const data = await this.fetchJsonRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, 'Gemini');
      return this.parseAIResponse(this.extractGeminiText(data));
    }

    const content = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
    ];
    const reply = await this.callOpenAICompatible(settings, provider, [
      { role: 'system', content: 'You are a resume extraction API. Output a single JSON object only.' },
      { role: 'user', content }
    ], { jsonMode: true });
    return this.parseAIResponse(reply);
  }

  looksLikeBadOcr(text) {
    const t = String(text || '');
    const traps = [
      /When converting images/i,
      /text may appear blurry/i,
      /Use proper model for generating images/i,
      /Translator may be able to transfer/i,
      /\*\*Citation:\*\*/i,
      /\\begin\{itemize\}/,
      /\\begin\{enumerate\}/,
      /Suggested:\s*\\begin/
    ];
    if (traps.some((re) => re.test(t))) return true;
    const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    if (/\\begin\{|\\item\s|\\end\{/.test(t) && cjk < 30) return true;
    return false;
  }

  cleanOcrMarkdown(text) {
    return String(text || '')
      .replace(/<\|ref\|>[\s\S]*?<\|\/ref\|>/g, '')
      .replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, '')
      .replace(/<\|[^|]+\|>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async ocrImageBase64(base64, mime, apiKey) {
    const data = await this.fetchJsonRetry('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-ai/DeepSeek-OCR',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mime};base64,${base64}`,
                detail: 'high'
              }
            },
            { type: 'text', text: '<|grounding|>Convert the document to markdown.' }
          ]
        }]
      })
    }, 'OCR');
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw || !String(raw).trim()) throw new Error('OCR 没有识别出文字');
    const text = this.cleanOcrMarkdown(raw);
    if (this.looksLikeBadOcr(text) || this.looksLikeBadOcr(raw)) {
      emitLog('warn', 'ocr.hallucination', 'OCR 输出像提示词串台/胡话，丢弃本页结果');
      throw new Error('OCR 输出异常（提示词串台或胡话），改用本地抽字');
    }
    if (!this.hasUsableText(text)) throw new Error('OCR 没有识别出可用文字');
    return text;
  }

  async testOcrConnection(apiKey) {
    if (!apiKey || !apiKey.trim()) throw new Error('请先输入硅基流动 API Key');
    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-ai/DeepSeek-OCR',
        messages: [{
          role: 'user',
          content: 'Hello, reply OK'
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = errText;
      try {
        const json = JSON.parse(errText);
        errMsg = json.error?.message || json.message || errText;
      } catch (e) {}
      throw new Error(`连接失败 (${response.status}): ${errMsg}`);
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || 'OK';
    return {
      model: 'deepseek-ai/DeepSeek-OCR',
      preview: String(reply).trim()
    };
  }

  async renderPdfPagesToPng(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF 解析库未加载，无法进行 OCR');
    }
    this.initPdfWorker();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const images = [];
    const count = pdf.numPages;
    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.4, Math.max(1.8, 1600 / Math.max(base.width, 1)));
      const viewport = page.getViewport({ scale });
      const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        : Object.assign(document.createElement('canvas'), {
          width: Math.ceil(viewport.width),
          height: Math.ceil(viewport.height)
        });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise((resolve, reject) => {
          canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('PDF 渲染失败'))), 'image/png');
        });
      images.push({ mime: 'image/png', base64: await this.fileToBase64(blob) });
    }
    if (!images.length) throw new Error('未能将 PDF 转为图片');
    return images;
  }

  async ocrFile(file, settings, onProgress) {
    const apiKey = settings.ocrApiKey;
    if (!apiKey) throw new Error('未配置 OCR API Key');

    if (this.isImageFile(file)) {
      this.notifyProgress(onProgress, 'ocr', '正在识别图片文字…');
      return this.ocrImageBase64(await this.fileToBase64(file), file.type || this.guessMime(file.name) || 'image/png', apiKey);
    }

    if (this.isPdfFile(file)) {
      this.notifyProgress(onProgress, 'ocr', '正在将 PDF 转为图片并识别…');
      const pages = await this.renderPdfPagesToPng(file);
      const texts = [];
      for (let i = 0; i < pages.length; i++) {
        this.notifyProgress(onProgress, 'ocr', `正在识别第 ${i + 1}/${pages.length} 页…`);
        try {
          texts.push(await this.ocrImageBase64(pages[i].base64, pages[i].mime, apiKey));
        } catch (error) {
          emitLog('warn', 'ocr.page-skip', `第 ${i + 1} 页 OCR 丢弃`, error.message);
        }
      }
      const merged = texts.join('\n\n');
      if (!this.hasUsableText(merged) || this.looksLikeBadOcr(merged)) {
        throw new Error('OCR 没有得到可用文档内容');
      }
      return merged;
    }

    throw new Error('当前文件不支持 OCR');
  }

  hasUsableText(text) {
    return String(text || '').replace(/\s+/g, '').length >= 20;
  }

  async parseFileWithAI(file, settings, options = {}) {
    if (!file) throw new Error('未选择简历文件');
    if (!settings.aiEnabled || !settings.aiApiKey) {
      throw new Error('请先在上方启用 AI 并填写 API Key');
    }

    const fileName = file.name || 'resume';
    const fallbackText = String(options.fallbackText || '').trim();
    const onProgress = options.onProgress;
    emitLog('info', 'parse.file.start', `开始解析文件：${fileName}`, {
      type: file.type,
      size: file.size,
      provider: settings.aiProvider,
      model: settings.aiModel
    });

    if (this.canSendFileDirect(settings, file)) {
      try {
        this.notifyProgress(onProgress, 'direct', '正在让模型直接读取原始文件…');
        const data = await this.parseDirectFile(file, settings);
        return { data, inputMode: 'file', fileName };
      } catch (error) {
        console.warn('[简历解析] 直接读取文件失败，准备回退:', error.message);
        this.notifyProgress(onProgress, 'fallback', '多模态直读失败，准备 OCR 或本地抽字…');
      }
    }

    const canOcr = !!(settings.ocrApiKey && (this.isPdfFile(file) || this.isImageFile(file)));
    if (canOcr) {
      try {
        this.notifyProgress(onProgress, 'ocr', '正在 OCR 识别文档…');
        const ocrText = await this.ocrFile(file, settings, onProgress);
        if (this.hasUsableText(ocrText) && !this.looksLikeBadOcr(ocrText)) {
          this.notifyProgress(onProgress, 'ocr-complete', 'OCR 完成，正在结构化提取…');
          const data = await this.parseWithAI(ocrText, settings);
          return {
            data,
            inputMode: 'text',
            extractedText: ocrText,
            extractionMode: 'ocr',
            fileName
          };
        }
        this.notifyProgress(onProgress, 'ocr-fallback', 'OCR 结果不可用，改为本地抽字…');
      } catch (error) {
        console.warn('[简历解析] OCR 失败，回退本地抽字:', error.message);
        this.notifyProgress(onProgress, 'ocr-fallback', 'OCR 未成功，改为本地抽字…');
      }
    }

    this.notifyProgress(onProgress, 'fallback', '正在本地提取文字…');
    let extractError = '';
    let text = fallbackText;
    if (!text && !this.isImageFile(file)) {
      try {
        text = String(await this.extractText(file) || '').trim();
      } catch (error) {
        extractError = error.message || '本地提取失败';
        text = '';
      }
    }

    if (this.hasUsableText(text)) {
      this.notifyProgress(onProgress, 'fallback', '本地文字已提取，正在结构化解析…');
      const data = await this.parseWithAI(text, settings);
      return {
        data,
        inputMode: 'text',
        extractedText: text,
        extractionMode: '',
        fileName
      };
    }

    throw new Error(extractError
      || '未能从文件中提取到文字。扫描件或图片请配置 OCR，或改用可直接读文件的模型');
  }

  buildPrompt(resumeText) {
    return `从下面的简历中提取全部结构化信息，返回一个合法的 JSON 对象。

必须返回严格合法的 JSON，不要包含任何 markdown 代码块标记（不要包含 \`\`\`json），不要输出额外解释。字段在简历中未提及可用 "" 或 []。

JSON schema 规范：
{
  "basicInfo": {
    "fullName": "",
    "firstName": "",
    "lastName": "",
    "phone": "",
    "email": "",
    "gender": "",
    "birthDate": "",
    "idCard": "",
    "politicalStatus": "",
    "ethnicity": "",
    "hometown": "",
    "graduationDate": "",
    "emergencyContact": "",
    "emergencyRelation": "",
    "emergencyPhone": "",
    "city": "",
    "state": "",
    "country": "",
    "zipCode": "",
    "street": "",
    "linkedin": "",
    "github": "",
    "website": "",
    "twitter": ""
  },
  "jobIntention": {
    "expectedCity": "",
    "expectedPosition": "",
    "expectedSalary": "",
    "availableDate": "",
    "referralCode": ""
  },
  "languageSkills": {
    "cet4": "",
    "cet6": "",
    "ielts": "",
    "toefl": "",
    "otherLanguages": ""
  },
  "awards": [
    {"name":"","level":"国家级/省部级/校级/院系级","date":""}
  ],
  "education": [
    {"school":"","college":"","major":"","degree":"大专/本科/硕士/博士","degreeType":"普通全日制统招/非全日制/海外留学生","startDate":"","endDate":"","gpa":"","rank":"","courses":""}
  ],
  "workExperience": [
    {"company":"","department":"","position":"","workType":"实习/全职","city":"","startDate":"","endDate":"","description":"","achievements":""}
  ],
  "projects": [
    {"name":"","role":"","projectType":"商业项目/科研课题/竞赛获奖/开源项目/课程设计","techStack":"","startDate":"","endDate":"","projectUrl":"","description":"","responsibilities":"","achievements":""}
  ],
  "skills": [],
  "introduction": "",
  "hrGreeting": ""
}

提取规则：
1. phone 只保留纯数字（如 13800138000）
2. 日期统一采用 YYYY-MM 或 YYYY-MM-DD
3. degree 统一规范为：大专 / 本科 / 硕士 / 博士
4. politicalStatus 如有提及规范为：中共党员 / 中共预备党员 / 共青团员 / 群众 / 民主党派
5. 四六级如有成绩（如 CET-6 580），填入 languageSkills.cet6 为 "580分" 或 "通过"
6. education/workExperience/projects/awards 只输出真实有效条目，无内容返回 []
7. hrGreeting：根据简历提炼一段用于 BOSS直聘/智联等招聘软件直接发给 HR 的打招呼语。包含：姓名、学校学历与专业、工作/实习（几段+简要概括）、项目经历（几个+简要概括）、重要大奖（仅限国奖、优秀毕业生、四六级550+、数学建模/ACM/计算机大赛一二三等奖等硬核大奖，过滤掉校内普通小奖）、个人优势。严格压缩在 200 字以内（履历极多时不得超过 300 字），真诚专业。

简历内容：
${resumeText}`;
  }

  async parseWithAI(resumeText, settings) {
    if (!settings.aiEnabled || !settings.aiApiKey) {
      throw new Error('请先在上方启用 AI 并填写 API Key');
    }
    const prompt = this.buildPrompt(resumeText);
    const messages = [
      {
        role: 'system',
        content: 'You are a resume extraction and career consulting API. Output a single JSON object strictly matching the schema. No markdown wrapping.'
      },
      { role: 'user', content: prompt }
    ];

    emitLog('info', 'parse.start', '开始用模型结构化提取简历', {
      provider: settings.aiProvider,
      model: settings.aiModel,
      chars: String(resumeText || '').length
    });
    let content;
    try {
      content = await this.chat(settings, messages, { jsonMode: true });
      try {
        const parsed = this.parseAIResponse(content);
        emitLog('success', 'parse.done', '结构化提取成功', {
          name: parsed.basicInfo && parsed.basicInfo.fullName,
          education: (parsed.education || []).length,
          skills: (parsed.skills || []).length
        });
        return parsed;
      } catch (firstError) {
        console.warn('[简历解析] JSON 不合法，要求模型重发:', firstError.message);
        emitLog('warn', 'parse.retry-json', '模型返回 JSON 不合法，正在要求重发', firstError.message);
        const retry = await this.chat(settings, [
          ...messages,
          { role: 'assistant', content: String(content || '') },
          { role: 'user', content: '上一份回复不是合法 JSON（数组元素之间可能缺逗号或被截断）。请只返回完整且可解析的 JSON 对象，不要 markdown，不要解释。' }
        ], { jsonMode: true });
        const parsed = this.parseAIResponse(retry);
        emitLog('success', 'parse.done', 'JSON 重发后解析成功', {
          name: parsed.basicInfo && parsed.basicInfo.fullName
        });
        return parsed;
      }
    } catch (error) {
      emitLog('error', 'parse.fail', '结构化提取失败', error.message);
      throw error;
    }
  }

  parseAIResponse(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('AI 返回为空');
    }

    let jsonStr = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
    else if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    jsonStr = jsonStr.trim();

    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      jsonStr = jsonStr.substring(start, end + 1);
    }

    const candidates = [jsonStr, repairJson(jsonStr)];
    let lastError;
    for (const candidate of candidates) {
      try {
        return this.validateAndCleanData(JSON.parse(candidate));
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(`AI 返回的 JSON 格式无法解析: ${lastError && lastError.message}`);
  }

  validateAndCleanData(data) {
    const str = (v) => (v == null ? '' : String(v).trim());
    const arr = (v) => (Array.isArray(v) ? v : []);
    const digitsPhone = (v) => {
      let digits = str(v).replace(/\D/g, '');
      if (digits.length >= 13 && digits.startsWith('86')) digits = digits.slice(2);
      if (digits.length >= 14 && digits.startsWith('086')) digits = digits.slice(3);
      return digits;
    };

    const bi = data.basicInfo || {};
    const ji = data.jobIntention || {};
    const ls = data.languageSkills || {};

    const cleaned = {
      basicInfo: {
        fullName: str(bi.fullName),
        firstName: str(bi.firstName),
        lastName: str(bi.lastName),
        phone: digitsPhone(bi.phone),
        email: str(bi.email),
        gender: str(bi.gender),
        birthDate: str(bi.birthDate),
        idCard: str(bi.idCard),
        politicalStatus: str(bi.politicalStatus),
        ethnicity: str(bi.ethnicity),
        hometown: str(bi.hometown),
        graduationDate: str(bi.graduationDate),
        emergencyContact: str(bi.emergencyContact),
        emergencyRelation: str(bi.emergencyRelation),
        emergencyPhone: digitsPhone(bi.emergencyPhone),
        city: str(bi.city),
        state: str(bi.state),
        country: str(bi.country),
        zipCode: str(bi.zipCode),
        street: str(bi.street),
        linkedin: str(bi.linkedin),
        github: str(bi.github),
        website: str(bi.website),
        twitter: str(bi.twitter)
      },
      jobIntention: {
        expectedCity: str(ji.expectedCity),
        expectedPosition: str(ji.expectedPosition),
        expectedSalary: str(ji.expectedSalary),
        availableDate: str(ji.availableDate),
        referralCode: str(ji.referralCode)
      },
      languageSkills: {
        cet4: str(ls.cet4),
        cet6: str(ls.cet6),
        ielts: str(ls.ielts),
        toefl: str(ls.toefl),
        otherLanguages: str(ls.otherLanguages)
      },
      awards: arr(data.awards).map((a) => ({
        name: str(a.name || a.title),
        level: str(a.level || '校级'),
        date: str(a.date || a.time)
      })).filter((a) => a.name),
      education: arr(data.education).map((e) => ({
        school: str(e.school),
        college: str(e.college || e.department),
        major: str(e.major),
        degree: str(e.degree || '本科'),
        degreeType: str(e.degreeType || '普通全日制统招'),
        startDate: str(e.startDate || e.start),
        endDate: str(e.endDate || e.end),
        gpa: str(e.gpa),
        rank: str(e.rank),
        courses: str(e.courses)
      })).filter((e) => e.school || e.major),
      workExperience: arr(data.workExperience).map((w) => ({
        company: str(w.company),
        department: str(w.department),
        position: str(w.position),
        workType: str(w.workType || '实习'),
        city: str(w.city),
        startDate: str(w.startDate || w.start),
        endDate: str(w.endDate || w.end),
        description: str(w.description),
        achievements: str(w.achievements)
      })).filter((w) => w.company || w.position),
      projects: arr(data.projects).map((p) => ({
        name: str(p.name),
        role: str(p.role),
        projectType: str(p.projectType || '商业项目'),
        techStack: str(p.techStack || (Array.isArray(p.technologies) ? p.technologies.join(', ') : '')),
        startDate: str(p.startDate || p.start),
        endDate: str(p.endDate || p.end),
        projectUrl: str(p.projectUrl || p.url),
        description: str(p.description),
        responsibilities: str(p.responsibilities),
        achievements: str(p.achievements)
      })).filter((p) => p.name),
      skills: arr(data.skills).map(str).filter(Boolean),
      introduction: str(data.introduction),
      hrGreeting: str(data.hrGreeting)
    };

    if (cleaned.basicInfo.fullName && !cleaned.basicInfo.lastName && !cleaned.basicInfo.firstName) {
      const name = cleaned.basicInfo.fullName.replace(/\s+/g, '');
      if (name.length >= 2 && !/[A-Za-z]/.test(name)) {
        cleaned.basicInfo.lastName = name[0];
        cleaned.basicInfo.firstName = name.slice(1);
      }
    }

    return cleaned;
  }

  async generateHrGreeting(profileData, settings) {
    if (!settings.aiEnabled || !settings.aiApiKey) {
      throw new Error('请先在上方启用 AI 并填写 API Key');
    }

    const summaryPrompt = `你是一个资深校招求职顾问。请根据以下求职者资料，生成一段用于在 BOSS直聘、智联招聘、猎聘、牛客 等平台直接发送给 HR 的求职打招呼自荐信。

【打招呼语必须包含的要素】：
1. 姓名、毕业院校、学历与专业
2. 实习/工作经历（概括有几段经历，精炼提及公司背景与核心业务亮点）
3. 核心项目经历（概括有几个核心项目，简要提及技术栈与业务难点）
4. 重要高光奖项罗列（重点突出：国家奖学金、优秀毕业生、四六级550分以上、数学建模/ACM/计算机大赛一二三等奖等硬核大奖；普通的院级/小奖学金直接忽略不写）
5. 个人核心优势与能力匹配点

【严格格式要求】：
- 语言风格：专业自信、真诚干练、直奔主题，适合直接作为开场白发送给 HR
- 字数控制：严格压缩在 200 字以内！如履历极其丰富，最多压缩在 300 字以内！
- 输出要求：只输出文案正文本身，不要输出任何解释、前后缀或 markdown 代码块。

求职者资料：
${typeof profileData === 'string' ? profileData : JSON.stringify(profileData, null, 2)}`;

    const messages = [
      {
        role: 'system',
        content: '你是一个资深校招求职顾问，专门撰写高回复率的 200 字 HR 直聊打招呼自荐文案。只输出文案正文，不要任何废话。'
      },
      {
        role: 'user',
        content: summaryPrompt
      }
    ];

    const content = await this.chat(settings, messages, {
      jsonMode: false,
      temperature: 0.3
    });

    return String(content || '').trim().replace(/^["'`]|["'`]$/g, '');
  }
}

function repairJson(str) {
  return String(str || '')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .replace(/}\s*{/g, '},{')
    .replace(/]\s*\[/g, '],[')
    .replace(/"\s*\n\s*"/g, '",\n"')
    .replace(/}\s*"/g, '},"')
    .replace(/]\s*"/g, '],"');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前环境无法解压 Word 文件');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const files = {};
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;
    const flag = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder('utf-8').decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    if (flag & 0x8) throw new Error('不支持的 Word 压缩格式');
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    let raw;
    if (method === 0) raw = compressed;
    else if (method === 8) raw = await inflateRaw(compressed);
    else throw new Error('不支持的 Word 压缩方式');
    files[name] = raw;
    offset = dataStart + compSize;
  }
  return files;
}

const resumeParser = new ResumeParser();
