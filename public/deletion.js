const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labels = { sources: '原始记录 / 日报', cards: '经历卡片', runs: '岗位分析', weeklyReports: '周报' };
export function deleteButton(collection, id) {
  return `<button type="button" class="small ghost danger" data-delete="${esc(id)}" data-collection="${collection}" aria-label="删除${labels[collection]}">删除</button>`;
}
export function bindDeletion({ state, api, operation, toast, openModal, busy }) {
  const modal = document.querySelector('#modal');
  const openTrash = () => {
    const items = state.trash || [];
    openModal('回收站', `<div class="stack"><div class="hint">删除的内容可在这里恢复。已有周报、岗位分析中的原文快照会保留。备份也包含回收站；这里的删除不是永久清除。</div>${items.length ? items.map(item => `<div class="trash-row"><div><h3>${esc(item.title)}</h3><p class="tiny muted">${labels[item.collection]} · ${new Date(item.deletedAt).toLocaleString('zh-CN')}</p></div><button class="small" data-restore="${item.id}" data-collection="${item.collection}">恢复</button></div>`).join('') : '<p class="muted">回收站是空的。</p>'}</div>`);
    modal.querySelectorAll('[data-restore]').forEach(button => {
      button.onclick = () => {
        modal.close();
        operation('正在恢复记录', 'restore', async () => {
          const result = await api('/api/restore', 'POST', { collection: button.dataset.collection, id: button.dataset.restore });
          toast(`已恢复 ${result.restored} 项${result.skipped ? `；${result.skipped} 条经历仍有其他已删除来源，请先恢复来源` : ''}`);
        });
      };
    });
  };
  document.querySelectorAll('[data-open-trash]').forEach(button => { button.disabled = Boolean(busy); button.onclick = openTrash; });
  document.querySelectorAll('[data-delete]').forEach(button => {
    button.disabled = Boolean(busy);
    button.onclick = () => {
      const { collection } = button.dataset; const id = button.dataset.delete;
      const item = state[collection]?.find(item => item.id === id); if (!item) return;
      const title = item.title || `${item.start} — ${item.end} · 周报`;
      const affected = collection === 'sources' ? state.cards.filter(card => card.evidence.some(e => e.sourceId === id)) : [];
      openModal('移到回收站', `<div class="stack"><h3>${esc(title)}</h3><p>删除后将从当前列表移除，不再用于新的生成任务。你可以在顶部「回收站」恢复。</p>${affected.length ? `<div class="hint amber">这条原文被 ${affected.length} 条经历引用，以下经历会一起移入回收站：${affected.map(card => esc(card.title)).join('、')}。恢复原文时会尝试一并恢复它们。</div>` : ''}<p class="tiny muted">已有周报和岗位分析的历史快照保持原样；删除经历卡片不会删除原始记录。</p><div class="row"><button id="cancel-delete">取消</button><button class="danger" id="confirm-delete">确认删除</button></div></div>`);
      document.querySelector('#cancel-delete').onclick = () => modal.close();
      document.querySelector('#confirm-delete').onclick = () => {
        modal.close();
        operation('正在移入回收站', 'delete', async () => {
          const result = await api('/api/trash', 'POST', { collection, id });
          toast(`已将 ${result.moved} 项移入回收站，可随时恢复`);
        });
      };
    };
  });
}
