const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dailyInput = { date: today(), completed: '', blockers: '', next: '' };
let weeklyDate = today(), activeWeekly = null;

export function journalView({ state, mode, disabled, traceHtml }) {
  const entries = state.sources.filter(s => s.kind === 'daily').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const reports = state.weeklyReports || [];
  const report = reports.find(r => r.id === activeWeekly) || reports[0];
  return `<div class="pagehead"><div><div class="eyebrow">A LITTLE EVERY DAY</div><h1>每天记一点，周五轻松一点。</h1><p>留下今天的进展与问题，到周末，连成一份有依据的工作周报。</p></div></div>
  <div class="workspace"><div class="stack"><section class="panel"><div class="panel-head"><h2>记录今日日报</h2><span class="step">每日 / 积累</span></div>
  <form id="daily-form" class="panel-body stack">
  <div class="field"><label for="daily-date">记录日期</label><input type="date" id="daily-date" required value="${esc(dailyInput.date)}"><small>支持补记；同日可追加记录，原文保留。</small></div>
  <div class="field"><label for="daily-completed">今天完成了什么</label><textarea id="daily-completed" required maxlength="12000" placeholder="一行一件事。写清你的动作和目前进度，例如：完成登录页联调，已通过测试环境验收。">${esc(dailyInput.completed)}</textarea></div>
  <div class="field"><label for="daily-blockers">问题与阻碍 · 选填</label><textarea id="daily-blockers" class="short-textarea" maxlength="5000" placeholder="什么卡住了？需要谁协助？">${esc(dailyInput.blockers)}</textarea></div>
  <div class="field"><label for="daily-next">下一步 · 选填</label><textarea id="daily-next" class="short-textarea" maxlength="5000" placeholder="接下来准备做什么？这是计划，不是已完成成果。">${esc(dailyInput.next)}</textarea></div>
  <div class="row between"><span class="tiny muted">只保存到本机，不调用模型</span><button class="primary" ${disabled()}>保存日报 →</button></div></form></section>
  <section class="panel"><div class="panel-head"><h2>最近的日报</h2><span class="tiny muted">${entries.length} 条记录</span></div><div class="panel-body">${entries.length ? entries.slice(0, 10).map(s => `<article class="source"><div class="row between"><h3>${esc(s.date)}</h3><button class="small ghost" data-source="${s.id}">查看原文 ↗</button></div><p>${esc(s.daily.completed)}</p><button class="small" data-week-date="${s.date}" ${disabled()}>生成这一周的周报</button></article>`).join('') : '<p class="muted tiny">每天记录一两件具体的事，周报就有了素材。</p>'}</div></section></div>
  <div class="stack"><section class="panel"><div class="panel-head"><h2>形成工作周报</h2><span class="step">每周 / 回顾</span></div><form id="weekly-form" class="panel-body stack"><div class="field"><label for="weekly-date">选择这一周中的任意一天</label><input type="date" id="weekly-date" required value="${esc(weeklyDate)}"><small>按周一至周日归集；不会把缺少记录的日期补成已完成。</small></div>
  <div class="hint">${mode === 'agent' ? 'Agent 会读取这一周的日报，归纳主题、合并重复事项，并为每条结论保留原文引用。日报会发送到配置的模型服务。' : '本地模式按完成、阻碍和计划归集原句，合并完全相同条目。不会自动判断旧计划是否已完成，导出前请核对。'}</div><button class="primary" ${disabled()}>生成周报 →</button></form></section>
  ${report ? reportView(report, traceHtml) : ''}
  ${reports.length ? `<section class="panel"><div class="panel-head"><h2>周报历史</h2></div><div class="panel-body">${reports.slice(0, 8).map(r => `<button class="history-row ${report?.id === r.id ? 'active' : ''}" data-week-report="${r.id}"><span>${esc(r.start)} — ${esc(r.end)}</span><span class="tiny muted">${r.mode === 'agent' ? 'Agent' : '本地'}</span></button>`).join('')}</div></section>` : ''}</div></div>`;
}

function reportView(report, traceHtml) {
  return `<section class="panel"><div class="panel-head"><div><h2>工作周报</h2><p class="tiny muted">${esc(report.start)} — ${esc(report.end)}</p></div><button class="small" data-week-export="${report.id}">导出 Markdown ↓</button></div>
  <div class="panel-body"><div class="hint">依据 ${report.sources.length} 条日报 · 覆盖 ${new Set(report.sources.map(s => s.date)).size} 天 · ${report.mode === 'agent' ? '模型归纳，请复核' : '原句归集'}<br>只汇总已记录内容，保留生成时的原文快照。</div>
  ${[['completed', '本周完成'], ['blockers', '问题与阻碍'], ['next', '后续计划']].map(([key, label]) => `<div class="section-label"><h3>${label}</h3></div>${key === 'blockers' ? '<p class="footnote">记录时的阻碍，是否仍未解决请核对。</p>' : key === 'next' ? '<p class="footnote">来自每天的下一步，是否仍待执行请核对。</p>' : ''}${report.sections[key].length ? report.sections[key].map(item => `<div class="weekly-item"><p>${esc(item.text)}</p><div class="row wrap">${[...new Set(item.evidence.map(e => e.sourceId))].map(sid => `<button class="small ghost citation" data-week-evidence="${sid}" data-week-id="${report.id}">[D${report.sources.findIndex(s => s.id === sid) + 1}] ${esc(report.sources.find(s => s.id === sid)?.date)} ↗</button>`).join('')}</div></div>`).join('') : '<p class="muted tiny">本周日报未记录此项。</p>'}`).join('')}${traceHtml(report.trace)}</div></section>`;
}

export function bindJournal({ state, mode, api, operation, toast, render, download, openModal }) {
  const $ = selector => document.querySelector(selector);
  async function generate(date) {
    weeklyDate = date;
    await operation('正在整理这一周的日报', 'weekly', async () => {
      const report = await api('/api/weekly', 'POST', { date, mode }); activeWeekly = report.id;
      toast('周报已生成，请核对计划和阻碍的最新状态');
    });
  }
  for (const field of ['date', 'completed', 'blockers', 'next']) {
    const el = $(`#daily-${field}`); if (el) el.oninput = event => { dailyInput[field] = event.target.value; };
  }
  if ($('#weekly-date')) $('#weekly-date').oninput = event => { weeklyDate = event.target.value; };
  if ($('#daily-form')) $('#daily-form').onsubmit = event => {
    event.preventDefault(); const input = { ...dailyInput };
    operation('正在保存日报', 'daily', async () => {
      const result = await api('/api/daily', 'POST', input);
      dailyInput.completed = ''; dailyInput.blockers = ''; dailyInput.next = ''; weeklyDate = input.date;
      toast(result.duplicate ? '相同日期与内容的日报已保存，无需重复提交' : '日报已保存，也可以从收件箱整理为经历');
    });
  };
  if ($('#weekly-form')) $('#weekly-form').onsubmit = event => { event.preventDefault(); generate(weeklyDate); };
  document.querySelectorAll('[data-week-date]').forEach(el => { el.onclick = () => generate(el.dataset.weekDate); });
  document.querySelectorAll('[data-week-report]').forEach(el => { el.onclick = () => { activeWeekly = el.dataset.weekReport; render(); }; });
  document.querySelectorAll('[data-week-export]').forEach(el => { el.onclick = () => { const report = state.weeklyReports.find(r => r.id === el.dataset.weekExport); download(`工作周报-${report.start}.md`, report.markdown, 'text/markdown;charset=utf-8'); }; });
  document.querySelectorAll('[data-week-evidence]').forEach(el => { el.onclick = () => {
    const report = state.weeklyReports.find(r => r.id === el.dataset.weekId); const source = report.sources.find(s => s.id === el.dataset.weekEvidence);
    openModal('周报的依据 · 日报原文快照', `<div class="stack"><h3>${esc(source.title)}</h3><div class="raw">${esc(source.content)}</div><div class="hint">这是生成该周报时保留的原文。</div></div>`);
  }; });
}
