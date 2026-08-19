# LaTeX简历解析示例

## 支持的LaTeX格式

AI可以智能识别LaTeX源码并提取信息。

---

## 示例1：标准LaTeX简历

```latex
\documentclass[11pt,a4paper]{moderncv}
\moderncvstyle{classic}
\usepackage[utf8]{inputenc}

\name{张}{三}
\phone[mobile]{+86~138~0013~8000}
\email{zhangsan@email.com}
\social[github]{zhangsan}
\social[linkedin]{zhangsan}

\begin{document}

\makecvtitle

\section{教育经历}
\cventry{2019.09 -- 2023.06}{计算机科学与技术}{北京大学}{北京}{本科}{GPA: 3.8/4.0}

\section{工作经历}
\cventry{2022.06 -- 2023.06}{前端开发工程师}{字节跳动}{北京}{}{
  \begin{itemize}
    \item 负责抖音Web端开发
    \item 使用React、TypeScript开发
  \end{itemize}
}

\section{项目经历}
\cventry{2022.03 -- 2022.12}{在线协作文档系统}{项目负责人}{}{}{
  \begin{itemize}
    \item 基于WebSocket实现实时协作
    \item 技术栈：React, Node.js, Redis
  \end{itemize}
}

\section{技能}
\cvitem{编程语言}{JavaScript, Python, Java, C++}
\cvitem{前端}{React, Vue, TypeScript, Webpack}
\cvitem{后端}{Node.js, Express, Django}

\end{document}
```

**AI解析结果：**
- ✅ 姓名：张三
- ✅ 手机：13800138000
- ✅ 邮箱：zhangsan@email.com
- ✅ GitHub：github.com/zhangsan
- ✅ 教育：北京大学、计算机科学与技术、本科、GPA 3.8/4.0
- ✅ 工作：字节跳动、前端开发工程师
- ✅ 项目：在线协作文档系统
- ✅ 技能：JavaScript, Python, React, Vue等

---

## 示例2：简化LaTeX格式

```latex
\section{基本信息}
姓名：李四 \\
手机：13900139000 \\
邮箱：lisi@email.com \\
GitHub: \href{https://github.com/lisi}{github.com/lisi}

\section{教育背景}
\textbf{清华大学} \hfill 2018.09 - 2022.06 \\
软件工程 | 本科 | GPA: 3.9/4.0

\section{实习经历}
\textbf{腾讯} - 后端开发实习生 \hfill 2021.06 - 2021.12 \\
\begin{itemize}
  \item 负责微信支付后端开发
  \item 使用Go语言，处理高并发场景
\end{itemize}

\section{技能清单}
\begin{itemize}
  \item 编程语言: Go, Python, Java
  \item 数据库: MySQL, Redis, MongoDB
  \item 云服务: AWS, 阿里云
\end{itemize}
```

---

## 示例3：纯文本LaTeX（从.tex文件复制）

```
% 简历模板

\documentclass{article}

\begin{document}

\title{王五的简历}

联系方式
- 手机: 13700137000
- 邮箱: wangwu@email.com
- 博客: wangwu.com

教育经历
上海交通大学, 2017-2021
专业: 数据科学, 学历: 本科
GPA: 3.7/4.0

项目经验
1. 机器学习推荐系统
   - 时间: 2020.03-2020.12
   - 使用Python、TensorFlow构建
   - 准确率提升15%

技能
Python, TensorFlow, Pandas, SQL, Docker

\end{document}
```

---

## AI智能处理能力

### 1. 命令识别
- `\section{}` → 章节标题
- `\textbf{}` → 粗体强调（通常是标题）
- `\href{url}{text}` → 链接
- `\cventry{}` → 简历条目
- `\begin{itemize}` → 列表项

### 2. 格式清理
- 自动忽略：`\documentclass`, `\usepackage`, `%注释`
- 自动转换：`\\` → 换行, `~` → 空格
- 智能分段：识别章节和内容

### 3. 信息推断
- 从章节标题判断内容类型
- 从格式推断重要性
- 自动提取日期、联系方式
- 智能分组相关信息

---

## 其他支持的格式

### Markdown
```markdown
# 张三

- 📱 13800138000
- 📧 zhangsan@email.com
- 🔗 github.com/zhangsan

## 教育经历
**北京大学** | 计算机科学 | 本科 | 2019-2023
- GPA: 3.8/4.0

## 技能
JavaScript, React, Node.js, Python
```

### HTML
```html
<h1>张三</h1>
<p>手机: 13800138000</p>
<p>邮箱: zhangsan@email.com</p>

<h2>教育经历</h2>
<div class="education">
  <strong>北京大学</strong>
  <span>2019-2023</span>
  <p>计算机科学 | 本科 | GPA: 3.8/4.0</p>
</div>
```

### 表格格式
```
姓名    张三
手机    13800138000
邮箱    zhangsan@email.com

教育经历
学校        专业            学历    时间
北京大学    计算机科学      本科    2019-2023
```

---

## 使用建议

### 1. LaTeX简历最佳实践
- ✅ 保留原始格式复制
- ✅ 包含所有LaTeX命令
- ✅ 不要手动删除注释
- ✅ 完整的section标记

### 2. 提高解析准确率
- 信息完整清晰
- 日期格式统一
- 避免过度排版
- 关键信息显眼

### 3. 解析后检查
- 日期格式是否正确
- 手机号是否完整
- GPA是否准确
- 技能是否去重

---

## 常见问题

### Q: LaTeX命令会被识别吗？
**A:** 会的，AI会：
- 识别`\section`等结构命令
- 提取`\textbf`等强调内容
- 解析`\href`等链接
- 忽略格式命令

### Q: 复杂的LaTeX模板支持吗？
**A:** 支持！包括：
- moderncv
- altacv
- awesome-cv
- 自定义模板

### Q: 需要编译后再复制吗？
**A:** 不需要！直接复制.tex源码即可。

### Q: 中文LaTeX支持吗？
**A:** 完全支持中英文混合。

---

## 测试用例

复制以下内容到解析框测试：

```latex
\section{个人信息}
姓名: 测试用户 \\
手机: 13800138000 \\
邮箱: test@email.com

\section{教育}
\textbf{测试大学} \hfill 2019-2023 \\
计算机专业, 本科, GPA: 3.5

\section{技能}
Python, JavaScript, React, Node.js
```

预期结果：
- 姓名：测试用户
- 手机：13800138000
- 邮箱：test@email.com
- 学校：测试大学
- 专业：计算机
- 学历：本科
- GPA：3.5
- 技能：Python, JavaScript, React, Node.js

---

**AI会智能理解各种格式，无需担心格式问题！** 🚀
