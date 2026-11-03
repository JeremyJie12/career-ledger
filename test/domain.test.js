import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFrom, localDraft, validateCard, validateMatches, localMatch, resumeFor, dateRange, dailySource, weeklySources, localWeekly, validateWeekly } from '../src/domain.js';
import { demoData } from '../examples/demo.js';

test('local draft preserves source verbatim and never assumes ownership or results', () => {
  const source = sourceFrom({ title: '研究方案', content: '团队目标是提升准确率 30%，我参与方案设计。' });
  const { card } = localDraft(source, []);
  assert.equal(card.action, source.content);
  assert.equal(card.contribution, '待确认'); assert.equal(card.outcome, '');
  assert.equal(validateCard(card, [source]).evidence[0].quote, source.content);
});
test('rejects fabricated citations and unrelated evidence', () => {
  const source = sourceFrom({ title: '测试', content: '我参与测试。' });
  const { card } = localDraft(source, []);
  assert.throws(() => validateCard({ ...card, evidence: [{ sourceId: source.id, quote: '我主导测试。' }] }, [source]), /逐字/);
  assert.throws(() => validateCard(card, [source], 'different'), /本次/);
});
test('matching rejects invented requirements and unconfirmed cards', () => {
  const { cards } = demoData(); const jd = '负责模型评测';
  const row = { requirement: jd, level: 'direct', cardIds: [cards[3].id], explanation: '匹配' };
  assert.throws(() => validateMatches([row], jd, cards), /已确认/);
  assert.throws(() => validateMatches([{ ...row, requirement: '十年经验', cardIds: [cards[0].id] }], jd, cards), /JD 原句/);
  assert.throws(() => validateMatches([{ ...row, cardIds: [] }], jd, cards), /缺少/);
});
test('local keyword overlap never claims direct qualification', () => {
  const { cards } = demoData(); const rows = localMatch('十年 TypeScript 经验\n独立负责商业化收入', cards);
  assert.equal(rows[0].level, 'adjacent'); assert.equal(rows[1].level, 'gap');
  assert.ok(rows.every(r => !r.cardIds.includes(cards[3].id)));
});
test('resume preserves approved wording and links each claim to exact source', () => {
  const state = demoData(); const run = { title: '产品经理', matches: [{ cardIds: [state.cards[2].id, state.cards[3].id] }] };
  const markdown = resumeFor(run, state);
  assert.ok(markdown.includes(state.cards[2].action));
  assert.ok(markdown.includes('个人贡献：参与'));
  assert.ok(markdown.includes(state.cards[2].evidence[0].quote));
  assert.ok(!markdown.includes('准确率提升 30%'));
});
test('date ranges preserve arbitrary inclusive endpoints and reject invalid or reversed dates', () => {
  assert.deepEqual(dateRange('2026-12-30', '2027-01-04'), { start: '2026-12-30', end: '2027-01-04' });
  assert.deepEqual(dateRange('2026-11-03', '2026-11-03'), { start: '2026-11-03', end: '2026-11-03' });
  assert.throws(() => dateRange('2026-02-30', '2026-03-01'));
  assert.throws(() => dateRange('2026-2-3', '2026-03-01'));
  assert.throws(() => dateRange('2026-11-04', '2026-11-03'));
  assert.throws(() => dateRange(undefined, '2026-11-03'));
});
test('weekly grouping keeps plans separate, deduplicates identical items and excludes adjacent weeks', () => {
  const notes = [
    dailySource({ date: '2026-11-02', completed: '完成需求梳理', next: '准备上线' }),
    dailySource({ date: '2026-11-03', completed: '完成需求梳理', blockers: '等待接口' }),
    dailySource({ date: '2026-11-09', completed: '不应进入本周' }),
  ];
  const week = weeklySources(notes, '2026-11-02', '2026-11-03');
  assert.equal(week.notes.length, 2);
  const sections = localWeekly(week.notes);
  assert.equal(sections.completed.length, 1); assert.equal(sections.completed[0].evidence.length, 2);
  assert.equal(sections.next[0].text, '准备上线');
  assert.ok(!sections.completed.some(s => s.text === '准备上线'));
  assert.notEqual(notes[0].hash, dailySource({ date: '2026-11-03', completed: '完成需求梳理', next: '准备上线' }).hash);
});
test('weekly model summaries cannot cite notes outside the selected week', () => {
  const note = dailySource({ date: '2026-11-02', completed: '完成设计' });
  const sections = { completed: [{ text: '完成设计', evidence: [{ sourceId: 'other-week', quote: '完成设计' }] }], blockers: [], next: [] };
  assert.throws(() => validateWeekly(sections, [note]), /原始记录/);
});
