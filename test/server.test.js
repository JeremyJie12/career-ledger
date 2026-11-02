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
  assert.equal((await api('/api/weekly', 'POST', { date: '2026-11-02', mode: 'local' })).status, 400);
  const daily = { date: '2026-11-02', completed: '完成接口联调', blockers: '等待验收', next: '准备发布' };
  const first = await api('/api/daily', 'POST', daily);
  assert.equal(first.data.source.kind, 'daily');
  assert.equal((await api('/api/daily', 'POST', daily)).data.duplicate, true);
  await api('/api/daily', 'POST', { ...daily, date: '2026-11-03', completed: '完成测试环境验收' });
  await api('/api/daily', 'POST', { ...daily, date: '2026-11-09', completed: '下一周的工作' });
  const run = (await api('/api/weekly', 'POST', { date: '2026-11-08', mode: 'local' })).data;
  assert.equal(run.sources.length, 2); assert.equal(run.start, '2026-11-02');
  assert.ok(run.markdown.includes('[D1]')); assert.ok(run.markdown.includes('准备发布'));
  assert.ok(!run.markdown.includes('下一周的工作'));
  await api('/api/daily', 'POST', { ...daily, completed: '同日追加的工作' });
  const backup = (await api('/api/backup')).data;
  assert.equal(backup.weeklyReports[0].markdown, run.markdown);
  assert.equal(backup.weeklyReports[0].sources.length, 2);
  assert.equal(backup.sources.length, 4);
});
