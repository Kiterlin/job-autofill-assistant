# Capybara 网申助手

Chrome 扩展，识别并填充校招 / 社招网申表单。资料存在本机，可建多套简历、记录投递进度；AI 解析与助填可选。

纯原生 JS，没有构建步骤，也没有 npm 依赖。

<p align="center">
  <img src="pictures/popup.png" alt="扩展弹窗：一键填充、AI 助填与资料完整度" width="380">
</p>

## 界面

配置页录入基础信息、家庭成员、证书、论文等秋招常见字段：

![资料配置页](pictures/options-profile.png)

弹窗、配置页、看板都是扩展自己的界面。下面这张填充效果拍的是仓库里的**示例表单**（`test/fixtures/demo-apply-form.html`），不是某家公司的真实招聘站：

![示例表单上的一键填充](pictures/fill-demo.png)

填充时会记下公司 / 岗位，投递看板里改进度、导出 CSV：

![投递看板](pictures/options-kanban.png)

## 能做什么

- **一键填充**：按中英文标签识别姓名、联系方式、政治面貌、教育 / 实习 / 项目等常见字段，兼容 React 等框架的受控输入
- **页面悬浮窗**：网申页右下角可直接填充、切换资料、记投递，不必打开弹窗
- **多套资料**：例如「校招后端」「实习前端」各一份，随时切换
- **秋招字段**：政治面貌、民族、籍贯、生源地、入党 / 入团时间、婚姻状况、家庭成员、院校层次、结构化证书、论文、专利、开源成果、常用问答、个人声明
- **投递看板**：在投、笔试、面试、Offer、挂了；支持搜索、备注、导出 CSV
- **可选 AI**：上传 PDF / Word / 图片解析进资料卡，生成 HR 打招呼语；弹窗「AI 助填」处理主观开放题
- **附件**：简历源文件存在本机 IndexedDB，可作网申代传附件
- **备份**：`chrome.storage.local` 存资料与投递记录，弹窗可导出 / 导入 JSON
- **其它**：深浅色主题、运行日志、使用说明页

## 安装

1. 打开 `chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」
4. 选仓库里的 `job-autofill-assistant/` 目录（含 `manifest.json` 的那一层）

改完代码后在扩展管理页点刷新。

## 使用

1. 点扩展图标 →「配置资料与简历」，手工填写或用 AI 解析简历
2. 打开企业校招 / 北森 / 莫招 / 大易 / Moka 等网申页
3. 点弹窗「一键填充」，或用页面悬浮窗
4. 填完务必自己核对一遍再提交；特殊级联下拉可能需要手选

AI 不是必开。要用的话在配置页填 API Key，支持 DeepSeek、通义千问、智谱 GLM、Kimi、豆包、硅基流动、OpenAI、Gemini。

## 隐私

简历、附件和投递记录只存在本机浏览器。启用 AI 后，解析或助填用的文本会发到你配置的模型接口。

## 开发

```
job-autofill-assistant/            # 仓库根（git 根，test/ 在这里）
├── test/run.mjs                   # 静态检查 + 单元测试
└── job-autofill-assistant/        # 扩展本体（Chrome 加载这一层）
    ├── manifest.json
    ├── popup/                     # 弹窗
    ├── options/                   # 配置页 / 投递看板 / 日志 / 帮助
    └── scripts/
        ├── background.js          # 消息中枢，唯一存储入口
        ├── content.js             # 表单识别与填充
        ├── storage.js             # 资料结构
        └── resume-parser.js       # AI 解析
```

```bash
# 仓库根目录
node test/run.mjs
```

popup / options / content 都不直接读写存储，一律发消息给 `background.js`。

重新截 README 图（需本机 Chrome 与 `~/.venvs/pw`）：

```bash
~/.venvs/pw/bin/python test/screenshot.py
```

## 许可

个人求职自用。填充结果不保证与目标网站完全一致，提交前请人工检查。
