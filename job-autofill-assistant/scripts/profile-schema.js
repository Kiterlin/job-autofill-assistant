// 扩展字段共用定义：存储、编辑器与解析器使用相同键名；空值不代表“否”。
const profileSchema = {
  basicInfo: { sourcePlace: '生源地', registeredAddress: '户籍地', nationality: '国籍', politicalJoinDate: '入党团时间', height: '身高（cm）', weight: '体重（kg）', health: '健康状况' },
  jobIntention: { acceptAdjustment: '是否服从调剂', acceptCounty: '是否接受县级公司工作', salaryCurrency: '薪资币种', salaryUnit: '金额单位', salaryPeriod: '月薪/年薪周期' },
  education: { academicDegree: '学位', secondMajor: '第二专业', schoolCity: '学校所在城市', advisor: '导师', laboratory: '实验室', researchArea: '研究方向', fullTime: '是否全日制', highestFullTime: '是否最高全日制学历', majorStatus: '主修状态' },
  projects: { projectLevel: '项目级别' },
  awards: { issuer: '颁奖单位', rank: '名次', description: '说明', url: '链接', role: '担当角色' },
  familyMembers: { birthDate: '出生日期' },
  papers: { name: '论文名称', date: '发表日期', publisher: '期刊/会议或出版社', authorOrder: '作者顺序', role: '担当角色', abstract: '摘要', url: '链接' },
  patents: { name: '专利名称', inventor: '专利人', date: '取得日期', description: '说明', url: '链接' },
  openSource: { url: '仓库链接', stars: 'Stars 数', date: '统计日期' },
  commonAnswers: { gameExperience: '游戏经历', programmingLanguages: '编程语言（按优先顺序，每行一个）', aiTools: 'AI 工具使用经历', hobbies: '爱好特长', strengthsWeaknesses: '优势不足', selfEvaluation: '自我评价', careerGoal: '求职目标' },
  customAnswers: { question: '问题（完整原文）', answer: '答案' },
  declarations: { question: '声明问题（完整原文）', answer: '是/否', explanation: '补充说明', company: '适用企业', hostname: '适用网站域名' }
};
const profileListKeys = ['education', 'workExperience', 'projects', 'awards', 'familyMembers', 'certificates', 'papers', 'patents', 'openSource', 'customAnswers', 'declarations'];
function extendedDefaults(section) {
  return Object.fromEntries(Object.keys(profileSchema[section] || {}).map(key => [key, key === 'programmingLanguages' ? [] : '']));
}
function mergeProfile(old, updates) {
  const merged = { ...old, ...updates };
  for (const [key, value] of Object.entries(updates)) {
    if (profileListKeys.includes(key) && Array.isArray(value)) {
      merged[key] = value.map(item => ({ ...(old[key] || []).find(previous => previous.id && previous.id === item.id), ...item }));
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = { ...old[key], ...value };
    }
  }
  return merged;
}
function profileWithoutFiles(profile) {
  return JSON.parse(JSON.stringify(profile, (key, value) => ['resumeFile', 'attachments', 'attachmentContents', 'dataUrl'].includes(key) ? undefined : value));
}
