import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'career-ledger-test-'));
  const server = createApp({ dataDir, config: {}, ...options }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  return { base, api, dataDir };
}
test('end-to-end: capture, deduplicate, review, match, snapshot, export, backup', async t => {
  const { api } = await fixture(t);
  const input = { title: '鉴权改造', content: '我参与 TypeScript 鉴权开发，完成测试环境验证。' };
  const a = await api('/api/sources', 'POST', input); const duplicate = await api('/api/sources', 'POST', input);
  assert.equal(duplicate.data.duplicate, true); assert.equal(a.data.source.id, duplicate.data.source.id);
  const draft = await api('/api/draft', 'POST', { sourceId: a.data.source.id, mode: 'local' });
  assert.equal(draft.data.status, 'draft');
  const before = await api('/api/match', 'POST', { title: '工程师', jd: 'TypeScript 鉴权', mode: 'local' });
  assert.equal(before.data.snapshot.cards.length, 0);
  const invalid = await api(`/api/cards/${draft.data.id}`, 'PATCH', { ...draft.data, status: 'confirmed' });
  assert.equal(invalid.status, 400);
  const approved = await api(`/api/cards/${draft.data.id}`, 'PATCH', { ...draft.data, contribution: '参与', status: 'confirmed' });
  assert.equal(approved.data.revision, 2); assert.equal(approved.data.history.length, 1);
  const run = await api('/api/match', 'POST', { title: '工程师', jd: 'TypeScript 鉴权', mode: 'local' });
  assert.equal(run.data.snapshot.cards.length, 1); assert.ok(run.data.markdown.includes(input.content));
  const changed = await api(`/api/cards/${draft.data.id}`, 'PATCH', { ...approved.data, action: '修订后的动作', status: 'draft' });
  assert.equal(changed.data.revision, 3);
  const oldRevision = await api(`/api/cards/${draft.data.id}`, 'PATCH', { ...approved.data, action: '过期页面' });
  assert.equal(oldRevision.status, 409);
  const final = (await api('/api/state')).data;
  assert.equal(final.runs[0].markdown, run.data.markdown);
  assert.equal(final.runs[0].snapshot.cards[0].action, input.content);
  assert.equal((await api('/api/backup')).data.sources.length, 1);
  assert.equal((await api('/api/demo', 'POST', {})).status, 409);
});
test('demo fixtures are explicit and never inserted into a non-empty workspace', async t => {
  const { api } = await fixture(t);
  assert.equal((await api('/api/demo', 'POST', {})).status, 200);
  const state = (await api('/api/state')).data;
  assert.equal(state.sources.length, 4); assert.equal(state.cards.filter(c => c.status === 'confirmed').length, 3);
  assert.ok(state.sources.every(s => s.title.startsWith('林舟')));
  assert.equal((await api('/api/demo', 'POST', {})).status, 409);
  const run = (await api('/api/match', 'POST', { title: '产品经理', jd: '需求业务流程\n模型评测', mode: 'local' })).data;
  const numberedTitles = [...run.markdown.matchAll(/^### E\d+ · (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(numberedTitles, run.snapshot.cards.map(c => c.title));
});
test('rejects cross-origin, hostile hosts, non-JSON writes and oversized input', async t => {
  const { base, api } = await fixture(t);
  assert.equal((await fetch(base + '/api/state', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const hostileStatus = await new Promise((resolve, reject) => { const req = http.get(base + '/api/state', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(hostileStatus, 403);
  assert.equal((await fetch(base + '/api/demo', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await api('/api/sources', 'POST', { title: 'x', content: 'x'.repeat(40001) })).status, 400);
  assert.equal((await api('/api/sources', 'POST', { title: 'x', content: 'x'.repeat(1024 * 1024) })).status, 413);
  assert.equal((await fetch(base + '/.env')).status, 404);
});
test('failed model run leaves the original source available for retry', async t => {
  const { api } = await fixture(t, { config: { baseUrl: 'https://model.example/v1', apiKey: 'test-key', model: 'mock' }, fetcher: async () => new Response('private provider response', { status: 503 }) });
  const saved = await api('/api/sources', 'POST', { title: '记录', content: '我参与测试。' });
  const draft = await api('/api/draft', 'POST', { sourceId: saved.data.source.id, mode: 'agent' });
  assert.equal(draft.status, 502); assert.ok(!draft.data.error.includes('private'));
  assert.equal((await api('/api/state')).data.sources.length, 1);
  assert.equal((await api('/api/draft', 'POST', { sourceId: saved.data.source.id, mode: 'local' })).status, 200);
});
test('atomic serialized updates do not lose concurrent writes; corrupt files are not reset', async t => {
  const { dataDir } = await fixture(t); const store = new Store(dataDir);
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.update(s => { s.sources.push({ id: i }); })));
  assert.equal((await store.read()).sources.length, 20);
  await writeFile(join(dataDir, 'ledger.json'), 'corrupt');
  await assert.rejects(store.update(s => { s.sources = []; }));
  assert.equal(await readFile(join(dataDir, 'ledger.json'), 'utf8'), 'corrupt');
});
test('daily-to-weekly API preserves dates, avoids duplicate posts and snapshots previous reports', async t => {
  const { api } = await fixture(t);
  assert.equal((await api('/api/weekly', 'POST', { start: '2026-11-02', end: '2026-11-08', mode: 'local' })).status, 400);
  const daily = { date: '2026-11-02', completed: '完成接口联调', blockers: '等待验收', next: '准备发布' };
  const first = await api('/api/daily', 'POST', daily);
  assert.equal(first.data.source.kind, 'daily');
  assert.equal((await api('/api/daily', 'POST', daily)).data.duplicate, true);
  await api('/api/daily', 'POST', { ...daily, date: '2026-11-03', completed: '完成测试环境验收' });
  await api('/api/daily', 'POST', { ...daily, date: '2026-11-09', completed: '下一周的工作' });
  const run = (await api('/api/weekly', 'POST', { start: '2026-11-02', end: '2026-11-08', mode: 'local' })).data;
  assert.equal(run.sources.length, 2); assert.equal(run.start, '2026-11-02');
  assert.ok(run.markdown.includes('[D1]')); assert.ok(run.markdown.includes('准备发布'));
  assert.ok(!run.markdown.includes('下一周的工作'));
  await api('/api/daily', 'POST', { ...daily, completed: '同日追加的工作' });
  const backup = (await api('/api/backup')).data;
  assert.equal(backup.weeklyReports[0].markdown, run.markdown);
  assert.equal(backup.weeklyReports[0].sources.length, 2);
  assert.equal(backup.sources.length, 4);
});
test('delete/restore API hides sources and dependent cards while preserving existing report snapshots', async t => {
  const { api } = await fixture(t);
  const source = (await api('/api/daily', 'POST', { date: '2026-11-02', completed: '参与 TypeScript 测试' })).data.source;
  const card = (await api('/api/draft', 'POST', { sourceId: source.id, mode: 'local' })).data;
  await api(`/api/cards/${card.id}`, 'PATCH', { ...card, contribution: '参与', status: 'confirmed' });
  const weekly = (await api('/api/weekly', 'POST', { start: '2026-11-02', end: '2026-11-08', mode: 'local' })).data;
  const run = (await api('/api/match', 'POST', { title: '工程师', jd: 'TypeScript 测试', mode: 'local' })).data;
  assert.equal((await api('/api/trash', 'POST', { collection: 'sources', id: source.id })).data.moved, 2);
  const hidden = (await api('/api/state')).data;
  assert.equal(hidden.sources.length, 0); assert.equal(hidden.cards.length, 0); assert.equal(hidden.trash.length, 2);
  assert.equal(hidden.runs[0].markdown, run.markdown); assert.equal(hidden.weeklyReports[0].markdown, weekly.markdown);
  assert.equal((await api('/api/draft', 'POST', { sourceId: source.id, mode: 'local' })).status, 404);
  assert.equal((await api(`/api/cards/${card.id}`, 'PATCH', { ...card, status: 'confirmed' })).status, 404);
  assert.equal((await api('/api/weekly', 'POST', { start: '2026-11-02', end: '2026-11-08', mode: 'local' })).status, 400);
  const empty = (await api('/api/match', 'POST', { title: '工程师', jd: 'TypeScript 测试', mode: 'local' })).data;
  assert.equal(empty.snapshot.cards.length, 0);
  assert.ok((await api('/api/backup')).data.sources[0].deletedAt);
  assert.equal((await api('/api/restore', 'POST', { collection: 'cards', id: card.id })).status, 409);
  assert.equal((await api('/api/restore', 'POST', { collection: 'sources', id: source.id })).data.restored, 2);
  for (const [collection, item] of [['runs', run], ['weeklyReports', weekly]]) {
    await api('/api/trash', 'POST', { collection, id: item.id });
    assert.ok(!(await api('/api/state')).data[collection].some(x => x.id === item.id));
    await api('/api/restore', 'POST', { collection, id: item.id });
    assert.equal((await api('/api/state')).data[collection].find(x => x.id === item.id).markdown, item.markdown);
  }
});
test('a weekly model result cannot save after its source was deleted mid-flight', async t => {
  let release; let signalStarted; let calls = 0; let source;
  const paused = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { signalStarted = resolve; });
  const reply = (name, args) => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }));
  const { api } = await fixture(t, {
    config: { baseUrl: 'https://model.example/v1', apiKey: 'test-key', model: 'mock' },
    fetcher: async () => {
      if (!calls++) { signalStarted(); await paused; return reply('read_week_notes', {}); }
      return reply('finish_weekly', { completed: [{ text: '完成测试', evidence: [{ sourceId: source.id, quote: '完成测试' }] }], blockers: [], next: [] });
    },
  });
  source = (await api('/api/daily', 'POST', { date: '2026-11-02', completed: '完成测试' })).data.source;
  const generating = api('/api/weekly', 'POST', { start: '2026-11-02', end: '2026-11-08', mode: 'agent' });
  await started;
  await api('/api/trash', 'POST', { collection: 'sources', id: source.id });
  release();
  assert.equal((await generating).status, 409);
  assert.equal((await api('/api/state')).data.weeklyReports.length, 0);
});
test('weekly reports use the exact inclusive custom range, including single-day and cross-year ranges', async t => {
  const { api } = await fixture(t);
  const dates = ['2026-12-29', '2026-12-30', '2027-01-01', '2027-01-04', '2027-01-05'];
  for (const date of dates) await api('/api/daily', 'POST', { date, completed: `完成 ${date} 的工作` });
  const deleted = (await api('/api/daily', 'POST', { date: '2027-01-02', completed: '不应纳入的已删除工作' })).data.source;
  await api('/api/trash', 'POST', { collection: 'sources', id: deleted.id });
  const { status, data: report } = await api('/api/weekly', 'POST', { start: '2026-12-30', end: '2027-01-04', mode: 'local' });
  assert.equal(status, 200);
  assert.equal(report.start, '2026-12-30'); assert.equal(report.end, '2027-01-04');
  assert.deepEqual(report.sources.map(s => s.date), ['2026-12-30', '2027-01-01', '2027-01-04']);
  assert.ok(report.markdown.includes('2026-12-30 — 2027-01-04'));
  assert.ok(!report.markdown.includes('2026-12-29')); assert.ok(!report.markdown.includes('已删除工作'));
  const single = (await api('/api/weekly', 'POST', { start: '2027-01-01', end: '2027-01-01', mode: 'local' })).data;
  assert.equal(single.sources.length, 1);
  for (const input of [
    { start: '2027-01-05', end: '2027-01-04' },
    { start: '2026-02-30', end: '2026-03-01' },
    { start: '2027-01-01' },
    { date: '2027-01-01' },
    { start: '2028-01-01', end: '2028-01-04' },
  ]) assert.equal((await api('/api/weekly', 'POST', { ...input, mode: 'local' })).status, 400);
  assert.equal((await api('/api/state')).data.weeklyReports.length, 2);
});
