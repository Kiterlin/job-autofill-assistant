# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 工作规则（必须遵守）

- 禁止生成总结文档；禁止每做完一件事就写一个文档，导致文档严重冗余
- 禁止做一堆测试，除非用户要求
- 禁止写一堆兜底代码，代码要保持简洁美观

## 项目概述

Capybara网申助手 —— Chrome 扩展（Manifest V3），自动识别并填充求职网申表单，支持多套简历资料、投递记录看板、AI 简历解析。纯原生 JS + DOM，**无构建步骤、无 npm 依赖、无框架**。

## 常用命令

```bash
# 静态检查 + 单元测试（自研跑器，零依赖），必须在仓库根目录运行
node test/run.mjs
```

没有 build/lint。开发流程：在 `chrome://extensions` 开启开发者模式 → "加载已解压的扩展程序" 选内层 `job-autofill-assistant/` 目录 → 改完代码在扩展页点刷新。

## 桌面副本同步

浏览器实际加载的是 Windows 桌面上的副本 `C:\Users\qq139\Desktop\job-autofill-assistant`（即 WSL 路径 `/mnt/c/Users/qq139/Desktop/job-autofill-assistant`），它**不会**随 WSL 源码自动更新。改完源码后必须同步到桌面，并提醒用户在扩展管理页点刷新：

```bash
rsync -a --delete /home/sunlight/myprojects/job-autofill-assistant/job-autofill-assistant/ /mnt/c/Users/qq139/Desktop/job-autofill-assistant/
```

注意结尾斜杠不能省（否则会嵌套复制）。不要用 `cp -r` 直接覆盖已存在的目标目录，会产生嵌套目录。

## 目录结构注意：仓库根 ≠ 扩展目录

manifest.json 在内层目录，测试在外层：

```
job-autofill-assistant/            # 仓库根（git 根，test/ 在这里）
├── test/run.mjs                   # 测试入口
└── job-autofill-assistant/        # 扩展本体（Chrome 加载这个目录）
    ├── manifest.json              # MV3，<all_urls> 注入 content script
    ├── popup/                     # 弹窗 UI（入口操作）
    ├── options/                   # 全屏配置页（含锚点 #kanban 投递看板、#help 帮助页）
    ├── scripts/
    │   ├── background.js          # 消息中枢 Service Worker
    │   ├── content.js             # 表单识别与填充核心（最大文件）
    │   ├── storage.js             # StorageManager 类
    │   └── resume-parser.js       # AI 解析器
    └── vendor/pdfjs/              # 内置 pdf.js（worker 经 chrome.runtime.getURL 加载）
```

## 架构

### 消息流：background 是唯一数据网关

popup/options/content 都不直接读写存储，全部走消息：

```
popup/options --runtime.sendMessage({action})--> background --> storageManager / resumeParser
popup         --tabs.sendMessage({action})-----> content.js    （fillPage、toggleDock 等页面操作）
content.js    --runtime.sendMessage-----------> background    （记录投递、日志等）
```

background.js 用一个 `switch (request.action)` 分发约 25 种 action（getActiveProfile、updateProfile、parseResume、addSubmission…）。新增数据操作的固定套路：background 加 case → 调 storageManager 方法 → popup/options 发消息调用。

### 存储：单 key 设计

所有数据存在 `chrome.storage.local` 的一个 key `jobAutofillData` 下：`{ profiles: [...], activeProfileId, settings, submissions, logs }`，StorageManager 带 500ms 防抖保存。资料字段结构以 `storage.js` 的 `getEmptyProfile()` 为准 —— basicInfo 含政治面貌、民族、籍贯等国内网申特有字段，经历为 education / workExperience / projects 动态数组。

### content.js 要点

- IIFE 封装，全局标志位防重复注入
- 赋值必须兼容 React 等框架：清空 `_valueTracker`、用原型上的 native setter 写值、手动派发 input/change 事件（见 `dispatchInputEvents` / `nativeSet`），改这里的赋值逻辑前先理解这套机制
- 字段识别靠 label/name/id/placeholder 的中英文关键词匹配，新字段类型加对应关键词即可

### resume-parser.js

- `AI_PROVIDERS` 定义 8 家提供商：除 Gemini 用自家 `generateContent` 格式（`gemini: true` 标记）外，其余均为 OpenAI 兼容 `/chat/completions`
- PDF 解析用 vendor/pdfjs；docx 不依赖外部库，自带 DecompressionStream 读 zip 的逻辑
