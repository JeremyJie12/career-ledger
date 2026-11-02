import { id, now, sourceFrom, validateCard } from '../src/domain.js';

// All names, organizations and outcomes in this fixture are fictional.
export const demoJobs = [
  { title: 'AI 产品经理', jd: '负责 AI 产品的需求调研、业务流程设计和交付验收。\n具备用户反馈分析和跨团队沟通经验。\n能够设计模型评测方案，理解模型输出的边界。\n有独立负责商业化收入的经验。' },
  { title: '前端工程师', jd: '熟悉 TypeScript 和 React，能够实现复杂交互。\n具备接口联调、鉴权和异步状态处理经验。\n能够编写自动化测试并定位线上问题。\n具有大型前端基础设施建设经验。' },
];
export function demoData() {
  const records = [
    ['林舟 · 工作记录 / 会话续期', '我负责松果笔记运营后台的会话续期改造。使用 TypeScript 和 React 实现请求前续期、401 后重试一次，以及并发请求共享刷新结果。补充了自动化测试。已在测试环境验收，尚未上线，没有线上改善数据。'],
    ['林舟 · 工作记录 / 用户反馈', '我独立完成了用户反馈整理工具的原型。访谈运营同事，梳理需求和业务流程，将反馈按问题主题分类，输出待复核清单。用 30 条人工编写的样例验证了导入和分类流程。30 条是测试样例数，不是用户规模。'],
    ['林舟 · 项目复盘 / 模型评测', '我参与松果笔记 AI 摘要的评测方案设计，负责整理评测维度和人工评审说明。模型接口和调度由后端同事实现。评测方案覆盖事实遗漏、无依据补充和格式一致性；目前完成方案评审，尚未开展正式评测。'],
    ['林舟 · 待核对 / 项目贡献', '本周周报草稿：我独立完成了 AI 摘要系统，准确率提升 30%。复盘备注：这个表述还没有核实，模型接口和调度由后端同事实现；30% 没有评测报告支持，不能作为成果使用。'],
  ];
  const sources = records.map(([title, content]) => sourceFrom({ title, content }));
  const definitions = [
    { title: '让会话续期成为用户无感的流程', contribution: '负责', action: '使用 TypeScript 和 React 实现运营后台请求前续期、401 后重试一次，以及并发请求共享刷新结果；补充自动化测试。', outcome: '完成测试环境验收；尚未上线，没有线上改善数据。', questions: [] },
    { title: '把零散用户反馈整理成待办线索', contribution: '独立完成', action: '访谈运营同事，梳理需求和业务流程，独立完成用户反馈整理工具原型，按问题主题分类并输出待复核清单。', outcome: '用 30 条人工编写的样例验证导入和分类流程；样例数不代表真实用户规模。', questions: [] },
    { title: '定义 AI 摘要的质量评测标准', contribution: '参与', action: '参与 AI 摘要评测方案设计，负责整理评测维度和人工评审说明，覆盖事实遗漏、无依据补充和格式一致性。', outcome: '完成方案评审，尚未开展正式评测。模型接口和调度由后端同事实现。', questions: [] },
    { title: '待澄清：AI 摘要的贡献与效果', contribution: '待确认', action: '周报中存在「独立完成」和「准确率提升 30%」的未经核实表述。', outcome: '', questions: ['个人负责范围与团队分工分别是什么？', '30% 是否有评测报告、指标定义与基线支持？'] },
  ];
  const cards = definitions.map((definition, i) => ({ ...validateCard({ ...definition, evidence: [{ sourceId: sources[i].id, quote: sources[i].content }] }, sources), id: id(), status: i === 3 ? 'draft' : 'confirmed', revision: 1, createdAt: now(), updatedAt: now(), history: [], trace: [{ tool: 'demo_fixture', summary: '虚构演示材料；非真实个人经历' }], mode: 'demo', relatedIds: [] }));
  cards[3].relatedIds = [cards[2].id];
  return { sources, cards };
}
