import test from 'node:test';
import assert from 'node:assert/strict';
import { CareerAgent } from '../src/agent.js';
import { sourceFrom, localDraft, dailySource } from '../src/domain.js';
import { demoData } from '../examples/demo.js';
const config = { baseUrl: 'https://model.example/v1', apiKey: 'test-not-a-real-key', model: 'test-model' };
const reply = (name, args) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }), { headers: { 'Content-Type': 'application/json' } });
test('agent reads source, searches cards, repairs invalid quotes, then returns a draft', async () => {
  const source = sourceFrom({ title: '评测', content: '我参与模型评测方案设计，尚未开展正式评测。' });
  const { card } = localDraft(source, []); let calls = 0;
  const replies = [reply('read_source', { sourceId: source.id }), reply('search_cards', { query: '评测' }), reply('finish_card', { ...card, evidence: [{ sourceId: source.id, quote: '不存在的引文' }], relatedIds: [] }), reply('finish_card', { ...card, relatedIds: [] })];
  const agent = new CareerAgent(config, async (url, options) => {
    assert.equal(url.href, 'https://model.example/v1/chat/completions');
    assert.ok(options.signal); assert.equal(JSON.parse(options.body).tools.length, 3);
    return replies[calls++];
  });
  const result = await agent.run('draft', source, { sources: [source], cards: [] }, 'agent');
  assert.equal(calls, 4); assert.equal(result.mode, 'agent');
  assert.equal(result.card.contribution, '待确认'); assert.ok(result.trace.some(t => t.summary.includes('校验未通过')));
});
test('agent must investigate before finishing and must obey the turn budget', async () => {
  const source = sourceFrom({ title: '笔记', content: '我参与测试。' }); const { card } = localDraft(source, []); let calls = 0;
  const agent = new CareerAgent(config, async () => { calls++; return reply('finish_card', { ...card, relatedIds: [] }); });
  await assert.rejects(agent.run('draft', source, { sources: [source], cards: [] }, 'agent'), /轮次上限/);
  assert.equal(calls, 7);
});
test('agent matching searches confirmed cards and validates evidence references', async () => {
  const state = demoData(); let calls = 0; const jd = '负责模型评测方案设计';
  const agent = new CareerAgent(config, async () => calls++ === 0 ? reply('search_cards', { query: '' }) : reply('finish_match', { matches: [{ requirement: jd, level: 'adjacent', cardIds: [state.cards[2].id], explanation: '参与过方案设计，尚无正式评测执行结果。' }] }));
  const result = await agent.run('match', { jd }, state, 'agent');
  assert.equal(result.matches[0].level, 'adjacent'); assert.equal(calls, 2);
});
test('provider errors are explicit and never echo secrets or switch silently to local mode', async () => {
  const state = demoData();
  const agent = new CareerAgent(config, async () => new Response('secret provider body', { status: 401 }));
  await assert.rejects(agent.run('draft', state.sources[0], state, 'agent'), error => error.message.includes('HTTP 401') && !error.message.includes('secret'));
  await assert.rejects(new CareerAgent({}).run('draft', state.sources[0], state, 'agent'), /配置/);
});
test('weekly agent must read selected notes and emits traceable summary sections', async () => {
  const source = dailySource({ date: '2026-11-02', completed: '完成评测方案设计', next: '开展正式评测' });
  let calls = 0;
  const agent = new CareerAgent(config, async () => calls++ === 0 ? reply('read_week_notes', {}) : reply('finish_weekly', {
    completed: [{ text: '完成评测方案设计', evidence: [{ sourceId: source.id, quote: '完成评测方案设计' }] }], blockers: [],
    next: [{ text: '开展正式评测', evidence: [{ sourceId: source.id, quote: '开展正式评测' }] }],
  }));
  const result = await agent.run('weekly', { start: '2026-11-02', end: '2026-11-08', notes: [source] }, { sources: [source], cards: [] }, 'agent');
  assert.equal(result.sections.completed.length, 1); assert.equal(result.sections.next.length, 1); assert.equal(result.trace[0].tool, 'read_week_notes');
});
