import { randomUUID, createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const emptyState = () => ({ version: 1, sources: [], cards: [], runs: [], weeklyReports: [] });
export const roles = ['独立完成', '主导', '负责', '参与', '协助', '待确认'];
export function text(value, name, max = 20000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(`${name}需为 1–${max} 字符`);
  return value.trim();
}
export function sourceFrom(input) {
  const content = text(input.content, '原始记录', 40000);
  return { id: id(), title: text(input.title, '标题', 160), content, hash: createHash('sha256').update(content).digest('hex'), createdAt: now() };
}
export function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new AppError('请选择有效日期');
  return value;
}
export function dateRange(start, end) {
  dateOnly(start); dateOnly(end);
  if (start > end) throw new AppError('开始日期不能晚于结束日期');
  return { start, end };
}
export function dailySource(input) {
  const date = dateOnly(input.date);
  const completed = text(input.completed, '今日完成', 12000);
  const blockers = typeof input.blockers === 'string' ? input.blockers.trim() : '';
  const next = typeof input.next === 'string' ? input.next.trim() : '';
  if (blockers.length > 5000 || next.length > 5000) throw new AppError('阻碍与下一步各最多 5000 字符');
  const content = `日期：${date}\n\n完成事项\n${completed}\n\n问题与阻碍\n${blockers || '未记录'}\n\n下一步\n${next || '未记录'}`;
  return { ...sourceFrom({ title: `${date} · 日报`, content }), hash: createHash('sha256').update(`daily\n${content}`).digest('hex'), kind: 'daily', date, daily: { completed, blockers, next } };
}
export function weeklySources(sources, start, end) {
  const range = dateRange(start, end);
  return { ...range, notes: sources.filter(s => !s.deletedAt && s.kind === 'daily' && s.date >= start && s.date <= end).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)) };
}
export function localWeekly(notes) {
  const group = field => {
    const items = new Map();
    for (const source of notes) {
      const value = source.daily[field]; if (!value) continue;
      for (const line of value.split('\n').map(s => s.trim()).filter(Boolean)) {
        const existing = items.get(line);
        if (existing) existing.evidence.push({ sourceId: source.id, quote: line });
        else items.set(line, { text: line, evidence: [{ sourceId: source.id, quote: line }] });
      }
    }
    return [...items.values()];
  };
  return { completed: group('completed'), blockers: group('blockers'), next: group('next') };
}
export function validateWeekly(input, notes) {
  const result = {};
  for (const field of ['completed', 'blockers', 'next']) {
    if (!Array.isArray(input[field]) || input[field].length > 40) throw new AppError('每个周报板块最多 40 条');
    result[field] = input[field].map(item => ({ text: text(item.text, '周报条目', 2000), evidence: validateEvidence(item.evidence, notes) }));
  }
  if (!result.completed.length) throw new AppError('周报至少需要一条完成事项');
  return result;
}
export function weeklyMarkdown(report) {
  const lines = [`# 工作周报 · ${report.start} — ${report.end}`, '', `基于 ${report.sources.length} 条日报记录 · ${report.mode === 'agent' ? '模型归纳，请对照来源复核' : '本地归集，合并完全相同条目'}`, ''];
  const references = new Map(report.sources.map((s, i) => [s.id, i + 1]));
  for (const [key, label] of [['completed', '期间完成'], ['blockers', '问题与阻碍（记录时状态）'], ['next', '后续计划（请核对是否仍待执行）']]) {
    lines.push(`## ${label}`, '');
    if (!report.sections[key].length) lines.push('所选时间段的日报未记录此项。', '');
    for (const item of report.sections[key]) lines.push(`- ${item.text} ${[...new Set(item.evidence.map(e => `[D${references.get(e.sourceId)}]`))].join(' ')}`);
    lines.push('');
  }
  lines.push('---', '', '## 日报原文', '');
  for (const source of report.sources) lines.push(`### D${references.get(source.id)} · ${source.title}`, '', ...source.content.split('\n').map(l => `> ${l}`), '');
  return lines.join('\n');
}
const terms = ['Agent', 'AI', 'Python', 'TypeScript', 'React', 'RAG', 'SQL', '测试', '产品', '需求', '数据', '权限', '接口', '状态', '模型', '运营', '报告', '评测', '用户', '设计', '调研', '分析', '沟通', '项目', '流程', '鉴权', '检索', '前端', '后端'];
export function tagsFor(s) { return terms.filter(t => s.toLowerCase().includes(t.toLowerCase())); }
export function validateEvidence(evidence, sources, requiredSourceId) {
  if (!Array.isArray(evidence) || !evidence.length || evidence.length > 12) throw new AppError('至少保留一条原文证据，最多 12 条');
  const checked = evidence.map(e => {
    const source = sources.find(s => s.id === e.sourceId);
    const quote = text(e.quote, '引用原文', 3000);
    if (!source || !source.content.includes(quote)) throw new AppError('引用必须逐字出现在原始记录中');
    return { sourceId: source.id, quote };
  });
  if (requiredSourceId && !checked.some(e => e.sourceId === requiredSourceId)) throw new AppError('缺少本次记录的引用');
  return checked;
}
export function validateCard(input, sources, requiredSourceId) {
  if (!roles.includes(input.contribution)) throw new AppError('无效的个人贡献类型');
  const questions = input.questions ?? [];
  if (!Array.isArray(questions) || questions.length > 8) throw new AppError('待补充问题最多 8 项');
  return {
    title: text(input.title, '经历标题', 160),
    action: text(input.action, '个人动作', 3000),
    outcome: typeof input.outcome === 'string' ? input.outcome.trim().slice(0, 2000) : '',
    contribution: input.contribution,
    tags: tagsFor(`${input.title} ${input.action} ${input.outcome || ''}`),
    evidence: validateEvidence(input.evidence, sources, requiredSourceId),
    questions: questions.map(q => text(q, '待补充问题', 300)),
  };
}
export function localDraft(source, cards) {
  const quote = source.content.slice(0, 2400);
  const tags = tagsFor(quote);
  const related = cards.filter(c => c.tags.some(t => tags.includes(t))).slice(0, 3);
  return {
    card: { title: source.title, action: quote, outcome: '', contribution: '待确认', evidence: [{ sourceId: source.id, quote }], questions: ['这段工作中，你本人负责什么？', '已经完成或上线了吗？有什么可核实的结果？'] },
    relatedIds: related.map(c => c.id),
    trace: [{ tool: 'read_source', summary: `读取「${source.title}」` }, { tool: 'search_cards', summary: `按显式标签找到 ${related.length} 条可能相关经历；不自动合并` }],
    mode: 'local',
  };
}
export function localMatch(jd, cards) {
  const requirements = jd.split(/\n|[；;]/).map(s => s.replace(/^[-*\d.、\s]+/, '').trim()).filter(Boolean).slice(0, 12);
  return requirements.map(requirement => {
    const tags = tagsFor(requirement);
    const candidates = cards.filter(c => c.status === 'confirmed').map(c => ({ c, n: c.tags.filter(t => tags.includes(t)).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 2);
    return { requirement, level: candidates.length ? 'adjacent' : 'gap', cardIds: candidates.map(x => x.c.id), explanation: candidates.length ? '仅发现相同关键词，尚未验证职责、年限或熟练度；请人工判断。' : '未找到关键词对应的已确认经历，不代表你一定不具备该能力。' };
  });
}
export function validateMatches(rows, jd, cards) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 15) throw new AppError('岗位分析应包含 1–15 项要求');
  return rows.map(row => {
    const requirement = text(row.requirement, '岗位要求', 1500);
    if (!jd.includes(requirement)) throw new AppError('岗位要求必须引用 JD 原句');
    if (!['direct', 'adjacent', 'gap'].includes(row.level)) throw new AppError('无效的匹配等级');
    if (!Array.isArray(row.cardIds) || row.cardIds.length > 5) throw new AppError('无效的经历引用');
    const cardIds = [...new Set(row.cardIds)];
    if (cardIds.some(cid => !cards.some(c => c.id === cid && c.status === 'confirmed'))) throw new AppError('只能使用已确认经历');
    if (row.level !== 'gap' && !cardIds.length) throw new AppError('匹配结论缺少经历证据');
    if (row.level === 'gap' && cardIds.length) throw new AppError('证据缺口不应附带匹配经历');
    return { requirement, level: row.level, cardIds, explanation: text(row.explanation, '匹配说明', 1500) };
  });
}
// The resume body is deterministic: never silently let an LLM rewrite approved claims.
export function resumeFor(run, state) {
  const ids = [...new Set(run.matches.flatMap(r => r.cardIds))];
  const cards = ids.map(cid => state.cards.find(c => c.id === cid && c.status === 'confirmed')).filter(Boolean);
  const lines = [`# ${run.title} · 经历精选`, '', '> 根据本人确认的经历原文生成。确认代表个人核对，不代表第三方认证。', ''];
  for (const [i, card] of cards.entries()) {
    lines.push(`## ${card.title}`, '', `个人贡献：${card.contribution}`, '', `${card.action} [E${i + 1}]`, '');
    if (card.outcome) lines.push(`结果：${card.outcome} [E${i + 1}]`, '');
  }
  if (!cards.length) lines.push('尚无可引用的已确认经历。请先整理并核对经历卡片。', '');
  lines.push('---', '', '## 证据索引（对外投递前可单独保留）', '');
  for (const [i, card] of cards.entries()) {
    lines.push(`### E${i + 1} · ${card.title}`, '');
    for (const e of card.evidence) {
      const source = state.sources.find(s => s.id === e.sourceId);
      lines.push(`来源：${source.title} · ${source.id}`, '', ...e.quote.split('\n').map(l => `> ${l}`), '');
    }
  }
  return lines.join('\n');
}
