#!/usr/bin/env node
/**
 * 扩展上线前静态检查 + 单测
 * 运行：node test/run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT, EXT, FIXTURES, read, exists, stripJs, declaredFunctions, classMethods,
  htmlIds, getElementByIds, loadScript, writeDocxFixture, makeChromeStorage
} from './helpers.mjs';

const results = [];
let failed = 0;

function ok(name, detail = '') {
  results.push({ name, pass: true, detail });
  console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail) {
  failed += 1;
  results.push({ name, pass: false, detail });
  console.log(`  FAIL  ${name}`);
  console.log(`        ${String(detail).split('\n').join('\n        ')}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

const BUILTINS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'void',
  'Promise', 'JSON', 'Date', 'Math', 'Number', 'String', 'Boolean', 'Array', 'Object',
  'Map', 'Set', 'WeakMap', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'fetch', 'btoa', 'atob', 'Blob', 'File', 'FileReader', 'URL',
  'Uint8Array', 'DataView', 'TextDecoder', 'TextEncoder', 'AbortController',
  'OffscreenCanvas', 'DecompressionStream', 'Response', 'Headers', 'Request',
  'console', 'chrome', 'document', 'window', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'confirm', 'prompt', 'alert', 'open',
  'parseFloat', 'unescape', 'escape', 'eval', 'isFinite',
  'resumeParser', 'storageManager', 'pdfjsLib', 'customElements',
  'HTMLElement', 'Event', 'CustomEvent', 'MutationObserver', 'IntersectionObserver',
  'ResizeObserver', 'CSS', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame',
  'cancelAnimationFrame', 'structuredClone', 'crypto', 'Intl', 'Proxy', 'Reflect',
  'Symbol', 'BigInt', 'WeakSet', 'ArrayBuffer', 'DataView', 'Float32Array',
  'Image', 'Option', 'DOMParser', 'XMLSerializer', 'FormData', 'URLSearchParams',
  'Worker', 'BroadcastChannel', 'MessageChannel', 'performance', 'atob',
  'CSSStyleSheet', 'ShadowRoot', 'Node', 'NodeFilter'
]);

function missingLocalCalls(js, extraKnown = []) {
  const known = new Set([...declaredFunctions(js), ...extraKnown, ...BUILTINS]);
  const stripped = stripJs(js).replace(/\basync\s+function\b/g, ' function ').replace(/\basync\s*\(/g, ' (');
  const missing = new Map();
  for (const match of stripped.matchAll(/(?<![.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    if (known.has(name) || BUILTINS.has(name)) continue;
    if (!/^[a-z][A-Za-z0-9]{3,}$/.test(name)) continue;
    if (['resolve', 'reject'].includes(name)) continue;
    missing.set(name, (missing.get(name) || 0) + 1);
  }
  return [...missing.entries()];
}

// ---------------------------------------------------------------------------
section('语法与清单');

for (const rel of [
  'scripts/resume-parser.js',
  'scripts/storage.js',
  'scripts/background.js',
  'scripts/content.js',
  'options/options.js',
  'popup/popup.js'
]) {
  const r = spawnSync(process.execPath, ['--check', path.join(EXT, rel)], { encoding: 'utf8' });
  if (r.status === 0) ok(`syntax ${rel}`);
  else fail(`syntax ${rel}`, r.stderr || r.stdout);
}

try {
  const manifest = JSON.parse(read('manifest.json'));
  if (manifest.manifest_version !== 3) fail('manifest v3', 'manifest_version != 3');
  else ok('manifest v3');
  const files = [
    manifest.action?.default_popup,
    manifest.options_page,
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {})
  ].filter(Boolean);
  const missingFiles = files.filter((f) => !exists(f));
  if (missingFiles.length) fail('manifest 引用文件存在', missingFiles.join(', '));
  else ok('manifest 引用文件存在', `${files.length} 个路径`);
  for (const extra of ['vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'scripts/storage.js', 'scripts/resume-parser.js']) {
    if (exists(extra)) ok(`资源 ${extra}`);
    else fail(`资源 ${extra}`, '文件不存在');
  }
} catch (e) {
  fail('manifest.json 可解析', e.message);
}

// ---------------------------------------------------------------------------
section('HTML id 与脚本引用');

function checkPage(htmlRel, jsRel) {
  const html = read(htmlRel);
  const js = read(jsRel);
  const ids = htmlIds(html);
  const used = getElementByIds(js);
  const missing = [...new Set(used)].filter((id) => !ids.has(id));
  // optional chaining getElementById('x')?. is still required to exist if we want UI
  if (missing.length) fail(`${htmlRel} 缺少 id`, missing.join(', '));
  else ok(`${jsRel} 用到的 id 都在 ${htmlRel}`, `${used.length} 处引用`);
}

checkPage('options/options.html', 'options/options.js');
checkPage('popup/popup.html', 'popup/popup.js');

for (const rel of ['options/options.html', 'popup/popup.html']) {
  const html = read(rel);
  const srcs = [...html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]);
  const broken = srcs.filter((src) => {
    if (src.startsWith('http') || src.startsWith('data:')) return false;
    const from = path.join(EXT, path.dirname(rel), src);
    return !fs.existsSync(from);
  });
  if (broken.length) fail(`${rel} 静态资源`, broken.join(', '));
  else ok(`${rel} 静态资源存在`);
}

// ---------------------------------------------------------------------------
section('后台消息与方法是否对得上');

const backgroundJs = read('scripts/background.js');
const storageJs = read('scripts/storage.js');
const parserJs = read('scripts/resume-parser.js');
const optionsJs = read('options/options.js');
const popupJs = read('popup/popup.js');
const contentJs = read('scripts/content.js');

const handledActions = new Set([...backgroundJs.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]));
handledActions.add('fillForm'); // content script
const sentActions = new Set();
for (const js of [optionsJs, popupJs, contentJs]) {
  for (const m of js.matchAll(/action:\s*'([^']+)'/g)) sentActions.add(m[1]);
}
const unknownActions = [...sentActions].filter((a) => !handledActions.has(a));
if (unknownActions.length) fail('未处理的 runtime action', unknownActions.join(', '));
else ok('前台发出的 action 后台都有处理', [...sentActions].join(', '));

const storageMethods = classMethods(storageJs, 'StorageManager');
const parserMethods = classMethods(parserJs, 'ResumeParser');
const requiredParser = [
  'parseFileWithAI', 'parseWithAI', 'parseAIResponse', 'listModels',
  'testConnection', 'testOcrConnection', 'generateHrGreeting', 'isSupported',
  'extractText', 'fetchJsonRetry', 'isBusyError'
];
const missingParser = requiredParser.filter((n) => !parserMethods.has(n));
if (missingParser.length) fail('ResumeParser 必要方法', missingParser.join(', '));
else ok('ResumeParser 必要方法齐全');

const requiredStorage = [
  'initialize', 'getActiveProfile', 'getAllProfiles', 'addProfile', 'updateProfile',
  'deleteProfile', 'setActiveProfile', 'getSettings', 'updateSettings',
  'getSubmissions', 'addSubmission', 'updateSubmission', 'deleteSubmission',
  'exportData', 'importData'
];
const missingStorage = requiredStorage.filter((n) => !storageMethods.has(n));
if (missingStorage.length) fail('StorageManager 必要方法', missingStorage.join(', '));
else ok('StorageManager 必要方法齐全');

const parserCalls = [...optionsJs.matchAll(/resumeParser\.(\w+)/g)].map((m) => m[1]);
const missingParserCalls = [...new Set(parserCalls)].filter((n) => !parserMethods.has(n));
if (missingParserCalls.length) fail('options.js 调用了不存在的 parser 方法', missingParserCalls.join(', '));
else ok('options.js 的 resumeParser.* 都能对上');

const storageCalls = [...backgroundJs.matchAll(/storageManager\.(\w+)/g)].map((m) => m[1]);
const missingStorageCalls = [...new Set(storageCalls)].filter((n) => !storageMethods.has(n));
if (missingStorageCalls.length) fail('background.js 调用了不存在的 storage 方法', missingStorageCalls.join(', '));
else ok('background.js 的 storageManager.* 都能对上');

for (const [label, js] of [['options.js', optionsJs], ['popup.js', popupJs]]) {
  const miss = missingLocalCalls(js, ['sendMessage']);
  if (miss.length) fail(`${label} 可能未定义的函数调用`, miss.map(([n, c]) => `${n}×${c}`).join(', '));
  else ok(`${label} 未见漏定义的本地函数调用`);
}

if (!optionsJs.includes('function debouncedSave')) fail('debouncedSave 已定义', 'options.js 中找不到 function debouncedSave');
else ok('debouncedSave 已定义');

if ((optionsJs.match(/function saveProfile/g) || []).length !== 1) {
  fail('saveProfile 唯一定义', '重复或缺失');
} else ok('saveProfile 唯一定义');

// ---------------------------------------------------------------------------
section('简历解析器');

const parser = loadScript('scripts/resume-parser.js').resumeParser;
if (!parser) fail('加载 resumeParser', 'vm 中没有 resumeParser');
else ok('加载 resumeParser');

const sampleText = fs.readFileSync(path.join(FIXTURES, 'sample-resume.txt'), 'utf8');

try {
  const parsed = parser.parseAIResponse(`这是一份优秀的简历
\`\`\`json
{
  "basicInfo": {
    "fullName": "张子涵",
    "phone": "(+86) 138-1234-5678",
    "email": "zihan.zhang_dev@example.com",
    "github": "github.com/zihan-dev-test",
    "city": "北京"
  },
  "education": [{"school":"北京航空航天大学","major":"计算机科学与技术","degree":"硕士"}],
  "workExperience": [{"company":"字节跳动","position":"后端开发实习生"}],
  "projects": [{"name":"智能简历解析助手"}],
  "skills": ["Python", "FastAPI"],
  "hrGreeting": "您好，我是张子涵"
}
\`\`\`
`);
  if (parsed.basicInfo.fullName !== '张子涵') throw new Error('姓名未解析');
  if (parsed.basicInfo.phone !== '13812345678') throw new Error('手机号未清洗: ' + parsed.basicInfo.phone);
  if (parsed.basicInfo.lastName !== '张') throw new Error('中文姓名未拆分');
  if (!parsed.education[0].school.includes('航空')) throw new Error('教育经历丢失');
  if (parsed.hrGreeting.indexOf('张子涵') < 0) throw new Error('打招呼语丢失');
  ok('parseAIResponse 能从混杂文本抽出 JSON 并清洗');
} catch (e) {
  fail('parseAIResponse', e.message);
}

try {
  parser.parseAIResponse('这是一份优秀的简历，包含姓名张子涵，没有json');
  fail('纯文本应判定为 JSON 失败', '没有抛错');
} catch (e) {
  if (/JSON|解析/i.test(e.message)) ok('纯文本会被拒绝');
  else fail('纯文本应判定为 JSON 失败', e.message);
}

try {
  const think = parser.parseAIResponse('<think>先分析一下</think>{"basicInfo":{"fullName":"李雷","phone":"13900001111"}}');
  if (think.basicInfo.fullName !== '李雷') throw new Error(JSON.stringify(think.basicInfo));
  ok('能去掉 <think> 再解析 JSON');
} catch (e) {
  fail('think 标签', e.message);
}

try {
  const repaired = parser.parseAIResponse(`{
    "basicInfo": {"fullName": "王五", "phone": "13700001111"},
    "skills": ["Python"
    "Docker"],
    "education": [{"school":"清华"}
    {"school":"北大"}]
  }`);
  if (repaired.basicInfo.fullName !== '王五') throw new Error('姓名');
  if (!repaired.skills.includes('Python') || !repaired.skills.includes('Docker')) throw new Error('skills ' + repaired.skills);
  if (repaired.education.length < 2) throw new Error('education len ' + repaired.education.length);
  ok('能修复数组元素缺逗号的 JSON');
} catch (e) {
  fail('缺逗号 JSON 修复', e.message);
}

try {
  const garbage = `When converting images, the text may appear blurry. Suggested: \\begin{itemize} \\item Use proper model`;
  if (!parser.looksLikeBadOcr(garbage)) throw new Error('应识别 OCR 胡话');
  if (parser.looksLikeBadOcr('# 孙露鹏\n电话 13961090143\n上海电力大学 硕士')) throw new Error('正常中文简历不该判胡话');
  const cleaned = parser.cleanOcrMarkdown('<|ref|>title<|/ref|><|det|>[[1,2,3,4]]<|/det|>姓名：张三');
  if (!cleaned.includes('张三') || cleaned.includes('<|ref|>')) throw new Error(cleaned);
  ok('OCR 胡话检测与 grounding 标记清理');
} catch (e) {
  fail('OCR 胡话检测', e.message);
}

try {
  if (!parser.isSupported({ name: 'a.pdf', type: 'application/pdf' })) throw new Error('pdf');
  if (!parser.isSupported({ name: 'a.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })) throw new Error('docx');
  if (!parser.isSupported({ name: 'shot.png', type: 'image/png' })) throw new Error('png');
  if (!parser.isSupported({ name: 'note.md', type: 'text/markdown' })) throw new Error('md');
  if (parser.canSendFileDirect({ aiProvider: 'gemini', aiModel: 'gemini-2.0-flash' }, { name: 'a.pdf', type: 'application/pdf' }) !== true) {
    throw new Error('gemini 应能直读 pdf');
  }
  if (parser.canSendFileDirect({ aiProvider: 'deepseek', aiModel: 'deepseek-chat' }, { name: 'a.pdf', type: 'application/pdf' })) {
    throw new Error('deepseek 不应直读 pdf');
  }
  ok('文件类型路由');
} catch (e) {
  fail('文件类型路由', e.message);
}

try {
  const file = new File([sampleText], 'resume.txt', { type: 'text/plain' });
  const extracted = await parser.extractText(file);
  if (!extracted.includes('张子涵')) throw new Error(extracted.slice(0, 80));
  ok('extractText 纯文本');
} catch (e) {
  fail('extractText 纯文本', e.message);
}

try {
  const docxPath = path.join(FIXTURES, 'sample.docx');
  writeDocxFixture(docxPath);
  const buf = fs.readFileSync(docxPath);
  const file = new File([buf], 'sample.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  const text = await parser.extractText(file);
  if (!text.includes('张子涵') || !text.includes('13812345678')) {
    throw new Error('抽取结果: ' + JSON.stringify(text).slice(0, 200));
  }
  ok('extractText DOCX');
} catch (e) {
  fail('extractText DOCX', e.message);
}

try {
  const latex = `\\documentclass{article}\\begin{document}姓名：王五 手机：13700001111\\end{document}`;
  const file = new File([latex], 'cv.tex', { type: 'text/plain' });
  const text = await parser.extractText(file);
  if (!text.includes('王五')) throw new Error(text);
  ok('extractText LaTeX/文本');
} catch (e) {
  fail('extractText LaTeX/文本', e.message);
}

try {
  const busy = new Error('Gemini API 错误 (503): {"error":{"status":"UNAVAILABLE","message":"high demand"}}');
  if (!parser.isBusyError(busy)) throw new Error('503 应视为繁忙');
  if (!parser.isBusyError(new Error('Failed to fetch'))) throw new Error('Failed to fetch 应重试');
  if (parser.isBusyError(new Error('API Key 无效'))) throw new Error('401 不应当繁忙');
  const msg = parser.formatApiError('Gemini', 503, '{"error":{"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
  if (!/繁忙|拥挤/.test(msg)) throw new Error(msg);
  if (/UNAVAILABLE/.test(msg) && /\{/.test(msg)) {
    // 允许不含原始 JSON
  }
  if (msg.includes('"status"')) throw new Error('用户可见错误不该是整段 JSON: ' + msg);
  ok('繁忙错误分类与提示');
} catch (e) {
  fail('繁忙错误分类与提示', e.message);
}

try {
  let calls = 0;
  const origFetch = parser.fetchJsonRetry.bind(parser);
  const fakeParserCtxFetch = async () => {
    calls += 1;
    if (calls < 3) {
      return {
        ok: false,
        status: 503,
        text: async () => '{"error":{"message":"high demand","status":"UNAVAILABLE"}}'
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '{"hello":1}'
    };
  };
  // monkeypatch global fetch used inside vm? parser.fetchJsonRetry uses fetch from vm context.
  // Re-load with custom fetch.
  let n = 0;
  const p2 = loadScript('scripts/resume-parser.js', {
    fetch: async () => {
      n += 1;
      if (n < 3) {
        return {
          ok: false,
          status: 503,
          text: async () => '{"error":{"message":"high demand","status":"UNAVAILABLE"}}'
        };
      }
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    }
  }).resumeParser;
  const data = await p2.fetchJsonRetry('https://example.com', { method: 'POST' }, 'Gemini');
  if (!data.ok) throw new Error(JSON.stringify(data));
  if (n !== 3) throw new Error('应重试到第 3 次, actual=' + n);
  ok('fetchJsonRetry 对 503 退避重试', `请求 ${n} 次后成功`);
} catch (e) {
  fail('fetchJsonRetry 503', e.message);
}

try {
  const p3 = loadScript('scripts/resume-parser.js', {
    fetch: async () => { throw new TypeError('Failed to fetch'); }
  }).resumeParser;
  try {
    await p3.fetchJsonRetry('https://example.com', {}, 'Gemini');
    throw new Error('应当抛错');
  } catch (e) {
    if (e.message === '应当抛错') throw e;
    if (!/限流|网络/.test(e.message)) throw new Error(e.message);
  }
  ok('Failed to fetch 转成可读错误');
} catch (e) {
  fail('Failed to fetch 转成可读错误', e.message);
}

try {
  const p4 = loadScript('scripts/resume-parser.js', {
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          basicInfo: { fullName: '张子涵', phone: '13812345678', email: 'a@b.com' },
          education: [{ school: '北航', major: '计科', degree: '硕士' }],
          workExperience: [],
          projects: [],
          skills: ['Python']
        }) } }]
      })
    })
  }).resumeParser;
  const file = new File([sampleText], 'resume.txt', { type: 'text/plain' });
  const result = await p4.parseFileWithAI(file, {
    aiEnabled: true,
    aiApiKey: 'sk-test',
    aiProvider: 'deepseek',
    aiModel: 'deepseek-chat'
  });
  if (result.inputMode !== 'text') throw new Error('txt 应变为文字模式, got ' + result.inputMode);
  if (result.data.basicInfo.fullName !== '张子涵') throw new Error('未写入解析结果');
  if (!result.extractedText.includes('张子涵')) throw new Error('未保留抽取文本');
  ok('parseFileWithAI 文本文件走本地抽取再解析');
} catch (e) {
  fail('parseFileWithAI 文本回退', e.stack || e.message);
}

try {
  let geminiCalls = 0;
  const p5 = loadScript('scripts/resume-parser.js', {
    fetch: async (url) => {
      geminiCalls += 1;
      return {
        ok: false,
        status: 503,
        text: async () => '{"error":{"message":"high demand","status":"UNAVAILABLE"}}'
      };
    }
  }).resumeParser;
  const file = new File([new Uint8Array([37, 80, 68, 70])], 'scan.pdf', { type: 'application/pdf' });
  try {
    await p5.parseDirectFile(file, {
      aiEnabled: true,
      aiApiKey: 'sk-test',
      aiProvider: 'gemini',
      aiModel: 'gemini-2.0-flash'
    });
    throw new Error('503 应当失败');
  } catch (e) {
    if (e.message === '503 应当失败') throw e;
    if (!/繁忙|拥挤/.test(e.message)) throw new Error(e.message);
  }
  if (geminiCalls < 2) throw new Error('直读 503 应有重试, calls=' + geminiCalls);
  ok('Gemini 直读 503 会重试并给出中文繁忙提示', `请求 ${geminiCalls} 次`);
} catch (e) {
  fail('Gemini 直读 503', e.message);
}

// ---------------------------------------------------------------------------
section('存储');

try {
  const ctx = loadScript('scripts/storage.js');
  const sm = ctx.storageManager;
  const data = await sm.initialize();
  if (!data.profiles?.length) throw new Error('未创建默认资料');
  if (!data.settings) throw new Error('缺少 settings');
  const profile = await sm.getActiveProfile();
  if (!profile.basicInfo || !Array.isArray(profile.education)) throw new Error('默认资料结构不完整');
  await sm.updateProfile(profile.id, { basicInfo: { ...profile.basicInfo, fullName: '测试用户' } });
  const again = await sm.getActiveProfile();
  if (again.basicInfo.fullName !== '测试用户') throw new Error('更新未生效');
  const sid = await sm.addSubmission({ company: '字节', position: '后端', status: '在投' });
  const list = await sm.getSubmissions();
  if (!list.length) throw new Error('投递记录未写入');
  const exported = await sm.exportData();
  JSON.parse(exported);
  ok('storage 初始化/更新/投递/导出');
} catch (e) {
  fail('storage', e.stack || e.message);
}

try {
  const ctx = loadScript('scripts/storage.js');
  const sm = ctx.storageManager;
  await sm.initialize();
  const profiles = await sm.getAllProfiles();
  const id = profiles[0].id;
  await sm.addEducation(id);
  await sm.addWorkExperience(id);
  await sm.addProject(id);
  const p = await sm.getActiveProfile();
  if (p.education.length < 2) throw new Error('教育条数 ' + p.education.length);
  ok('动态添加教育/工作/项目');
} catch (e) {
  fail('动态添加经历', e.message);
}

// ---------------------------------------------------------------------------
section('内容脚本与弹窗脚本可加载');

try {
  const fakeDoc = {
    readyState: 'complete',
    body: { appendChild() {} },
    documentElement: { getAttribute: () => 'dark', setAttribute() {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {} },
      setAttribute() {}, addEventListener() {}, appendChild() {},
      innerHTML: '', textContent: ''
    }),
    addEventListener() {}
  };
  loadScript('scripts/content.js', { document: fakeDoc, window: { matchMedia: () => ({ matches: false, addEventListener() {} }) } });
  ok('content.js 可在空页面上下文加载');
} catch (e) {
  fail('content.js 加载', e.message);
}

try {
  loadScript('popup/popup.js', {
    document: {
      readyState: 'complete',
      documentElement: { getAttribute: () => 'dark', setAttribute() {} },
      addEventListener() {},
      getElementById: () => ({
        addEventListener() {}, value: '', innerHTML: '', style: {},
        textContent: '', classList: { add() {}, remove() {} },
        querySelector: () => null, querySelectorAll: () => []
      }),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
      body: { appendChild() {} }
    },
    window: {
      matchMedia: () => ({ matches: false, addEventListener() {} })
    }
  });
  ok('popup.js 可加载');
} catch (e) {
  fail('popup.js 加载', e.message);
}

// ---------------------------------------------------------------------------
section('汇总');
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过, ${failed} 失败`);
if (failed) {
  console.log('\n失败项:');
  for (const r of results.filter((x) => !x.pass)) console.log(` - ${r.name}: ${r.detail}`);
  process.exit(1);
}
console.log('全部通过，可以再导入浏览器扩展做一次真机点选。');
