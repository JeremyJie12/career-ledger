import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Store } from './store.js';
import { CareerAgent, configFromEnv, isConfigured } from './agent.js';
import { AppError, id, now, text, sourceFrom, validateCard, resumeFor, dailySource, weeklySources, weeklyMarkdown } from './domain.js';
import { demoData, demoJobs } from '../examples/demo.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(resolve(root, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const assets = { '/journal.js': ['journal.js', 'text/javascript; charset=utf-8'], '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('只接受 JSON 请求', 415);
  const chunks = await new Promise((resolve, reject) => {
    const parts = []; let size = 0; let tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) { if (!tooLarge) reject(new AppError('请求过大（最多 1 MB）', 413)); tooLarge = true; parts.length = 0; }
      else if (!tooLarge) parts.push(chunk);
    });
    req.on('end', () => resolve(parts)); req.on('error', reject);
  });
  try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { throw new AppError('JSON 格式无效'); }
}
function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
export function createApp({ dataDir = resolve(process.env.CAREER_DATA_DIR || resolve(root, 'data')), config = configFromEnv(), fetcher } = {}) {
  const store = new Store(dataDir); const agent = new CareerAgent(config, fetcher); const active = new Set();
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new AppError('仅支持本机访问', 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new AppError('不允许跨站访问本地资料', 403);
      const path = new URL(req.url, `http://${host}`).pathname;
      if (req.method === 'GET' && assets[path]) {
        const [file, type] = assets[path]; return send(res, 200, await readFile(resolve(root, 'public', file)), type);
      }
      if (req.method === 'GET' && path === '/api/state') return send(res, 200, { ...await store.read(), configured: isConfigured(config), model: config.model || null, demoJobs });
      if (req.method === 'GET' && path === '/api/backup') return send(res, 200, await store.read());
      if (req.method === 'POST' && ['/api/sources', '/api/daily'].includes(path)) {
        const input = await body(req);
        const source = path === '/api/daily' ? dailySource(input) : sourceFrom(input);
        const saved = await store.update(state => {
          const old = state.sources.find(s => s.hash === source.hash);
          if (old) return { source: old, duplicate: true };
          if (state.sources.length >= 500) throw new AppError('第一版最多保存 500 条记录，请先导出备份');
          state.sources.unshift(source); return { source, duplicate: false };
        });
        return send(res, 200, saved);
      }
      if (req.method === 'POST' && path === '/api/weekly') {
        const input = await body(req); const state = await store.read();
        const week = weeklySources(state.sources, input.date);
        if (!week.notes.length) throw new AppError('这一周还没有日报，请先记录一天的工作');
        if (week.notes.length > 30 || week.notes.reduce((sum, s) => sum + s.content.length, 0) > 60000) throw new AppError('单次周报最多处理 30 条日报、60000 字符，请减少单周资料量');
        const key = `weekly:${week.start}`;
        if (active.has(key)) throw new AppError('这一周的周报正在生成中', 409);
        active.add(key);
        try {
          const result = await agent.run('weekly', week, state, input.mode);
          const report = { id: id(), start: week.start, end: week.end, createdAt: now(), mode: result.mode, sections: result.sections, sources: week.notes, trace: result.trace };
          report.markdown = weeklyMarkdown(report);
          await store.update(current => { current.weeklyReports.unshift(report); current.weeklyReports = current.weeklyReports.slice(0, 100); });
          return send(res, 200, report);
        } finally { active.delete(key); }
      }
      if (req.method === 'POST' && path === '/api/draft') {
        const input = await body(req); const key = `draft:${input.sourceId}`;
        if (active.has(key)) throw new AppError('这条记录正在整理中', 409);
        active.add(key);
        try {
          const state = await store.read(); const source = state.sources.find(s => s.id === input.sourceId);
          if (!source) throw new AppError('记录不存在', 404);
          const result = await agent.run('draft', source, state, input.mode);
          const card = { ...validateCard(result.card, state.sources, source.id), id: id(), status: 'draft', revision: 1, createdAt: now(), updatedAt: now(), history: [], relatedIds: result.relatedIds, trace: result.trace, mode: result.mode };
          await store.update(current => { validateCard(card, current.sources, source.id); current.cards.unshift(card); });
          return send(res, 200, card);
        } finally { active.delete(key); }
      }
      if (req.method === 'PATCH' && path.startsWith('/api/cards/')) {
        const cid = path.split('/').pop(); const input = await body(req);
        const saved = await store.update(state => {
          const card = state.cards.find(c => c.id === cid); if (!card) throw new AppError('经历不存在', 404);
          if (input.revision !== card.revision) throw new AppError('经历已被其他页面更新，请刷新后再保存', 409);
          if (!['draft', 'confirmed'].includes(input.status)) throw new AppError('无效的确认状态');
          const checked = validateCard({ ...input, evidence: card.evidence }, state.sources);
          if (input.status === 'confirmed' && checked.contribution === '待确认') throw new AppError('确认前请明确个人贡献');
          const { history, ...snapshot } = card;
          Object.assign(card, checked, { status: input.status, updatedAt: now(), revision: card.revision + 1, history: [...history, snapshot].slice(-30) });
          return card;
        });
        return send(res, 200, saved);
      }
      if (req.method === 'POST' && path === '/api/match') {
        if (active.has('match')) throw new AppError('岗位分析正在进行中', 409);
        const input = await body(req); const jd = text(input.jd, '岗位描述', 20000); const title = text(input.title, '岗位名称', 160);
        active.add('match');
        try {
          const state = await store.read();
          const result = await agent.run('match', { jd }, state, input.mode);
          const run = { id: id(), title, jd, matches: result.matches, trace: result.trace, mode: result.mode, createdAt: now() };
          // Store an immutable evidence snapshot so later edits cannot change a past export.
          const selectedIds = [...new Set(run.matches.flatMap(m => m.cardIds))];
          const selectedCards = selectedIds.map(cid => state.cards.find(c => c.id === cid)).filter(Boolean);
          run.snapshot = { cards: selectedCards, sources: state.sources.filter(s => selectedCards.some(c => c.evidence.some(e => e.sourceId === s.id))) };
          run.markdown = resumeFor(run, run.snapshot);
          await store.update(current => { current.runs.unshift(run); current.runs = current.runs.slice(0, 50); });
          return send(res, 200, run);
        } finally { active.delete('match'); }
      }
      if (req.method === 'POST' && path === '/api/demo') {
        await body(req);
        await store.update(state => {
          if (state.sources.length || state.cards.length || state.runs.length) throw new AppError('演示数据只可载入空账本，以免混入你的真实经历', 409);
          Object.assign(state, demoData());
        });
        return send(res, 200, { ok: true });
      }
      throw new AppError('未找到这个页面或操作', 404);
    } catch (e) {
      // Do not echo provider payloads, keys, private notes or disk paths into errors.
      if (!res.headersSent) send(res, e instanceof AppError ? e.status : 500, { error: e instanceof AppError ? e.message : '本地服务处理失败，请检查磁盘与数据文件；原始文件不会被自动重置' });
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  const server = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`Career Ledger · http://127.0.0.1:${server.address().port}`));
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请在 .env 中更换 PORT` : '无法启动本地服务'); process.exitCode = 1; });
}
