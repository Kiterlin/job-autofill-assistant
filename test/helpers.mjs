import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const EXT = path.join(ROOT, 'job-autofill-assistant');
export const FIXTURES = path.join(here, 'fixtures');

export function read(rel) {
  return fs.readFileSync(path.join(EXT, rel), 'utf8');
}

export function exists(rel) {
  return fs.existsSync(path.join(EXT, rel));
}

export function stripJs(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:\\.|[^\\`])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

export function declaredFunctions(js) {
  const names = new Set();
  for (const re of [
    /function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g
  ]) {
    for (const match of js.matchAll(re)) names.add(match[1]);
  }
  return names;
}

export function classMethods(js, className) {
  const names = new Set();
  const start = js.indexOf(`class ${className}`);
  if (start < 0) return names;
  const body = js.slice(start);
  for (const match of body.matchAll(/(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*\{/g)) {
    if (!['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(match[1])) {
      names.add(match[1]);
    }
  }
  return names;
}

export function htmlIds(html) {
  return new Set([...html.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1]));
}

export function getElementByIds(js) {
  return [...js.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
}

export function makeChromeStorage() {
  const store = {};
  return {
    runtime: {
      lastError: null,
      getURL: (p) => p,
      sendMessage() {},
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} }
    },
    storage: {
      local: {
        get(key, cb) {
          const k = typeof key === 'string' ? key : Object.keys(key)[0];
          cb({ [k]: store[k] });
        },
        set(obj, cb) {
          Object.assign(store, obj);
          cb && cb();
        },
        remove(key, cb) {
          delete store[key];
          cb && cb();
        },
        getBytesInUse(key, cb) {
          const raw = store[key] == null ? '' : JSON.stringify(store[key]);
          cb(Buffer.byteLength(raw));
        }
      },
      onChanged: { addListener() {} }
    },
    tabs: {
      query: async () => [],
      sendMessage() {},
      create() {}
    },
    scripting: {
      executeScript: async () => {},
      insertCSS: async () => {}
    }
  };
}

export function loadScript(rel, extra = {}) {
  const code = read(rel);
  const chrome = extra.chrome || makeChromeStorage();
  const ctx = {
    chrome,
    console,
    fetch: extra.fetch || (async () => { throw new Error('fetch disabled in tests'); }),
    AbortController,
    DecompressionStream: globalThis.DecompressionStream,
    Blob: globalThis.Blob,
    Response: globalThis.Response,
    File: globalThis.File,
    Uint8Array,
    DataView,
    TextDecoder,
    TextEncoder,
    JSON,
    Date,
    String,
    Number,
    Array,
    Object,
    Error,
    TypeError,
    setTimeout,
    clearTimeout,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    encodeURIComponent,
    pdfjsLib: extra.pdfjsLib,
    document: extra.document,
    window: extra.window,
    FileReader: extra.FileReader || class {
      constructor() {
        this.result = null;
        this.onload = null;
        this.onerror = null;
      }
      readAsText(file) {
        Promise.resolve().then(async () => {
          try {
            this.result = typeof file.text === 'function' ? await file.text() : String(file);
            this.onload && this.onload({ target: this });
          } catch (error) {
            this.onerror && this.onerror(error);
          }
        });
      }
      readAsDataURL(file) {
        Promise.resolve().then(async () => {
          const buf = Buffer.from(await file.arrayBuffer());
          this.result = `data:${file.type || 'application/octet-stream'};base64,${buf.toString('base64')}`;
          this.onload && this.onload({ target: this });
        });
      }
    },
    OffscreenCanvas: globalThis.OffscreenCanvas,
    URL: globalThis.URL,
    Buffer,
    process
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    code + `
this.resumeParser = typeof resumeParser !== 'undefined' ? resumeParser : this.resumeParser;
this.storageManager = typeof storageManager !== 'undefined' ? storageManager : this.storageManager;
this.ResumeParser = typeof ResumeParser !== 'undefined' ? ResumeParser : this.ResumeParser;
this.StorageManager = typeof StorageManager !== 'undefined' ? StorageManager : this.StorageManager;
`,
    ctx,
    { filename: rel }
  );
  return ctx;
}

export function writeDocxFixture(outPath) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>张子涵</w:t></w:r></w:p>
    <w:p><w:r><w:t>手机：13812345678</w:t></w:r></w:p>
    <w:p><w:r><w:t>邮箱：zihan@example.com</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  execFileSync('python3', ['-c', `
from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path
p = Path(${JSON.stringify(outPath)})
p.parent.mkdir(parents=True, exist_ok=True)
xml = ${JSON.stringify(xml)}
with ZipFile(p, 'w', ZIP_DEFLATED) as z:
    z.writestr('word/document.xml', xml)
    z.writestr('[Content_Types].xml', '<Types></Types>')
`]);
}
