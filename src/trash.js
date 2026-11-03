import { AppError, id, now } from './domain.js';

export const collections = ['sources', 'cards', 'runs', 'weeklyReports'];
const titleFor = item => item.title || `${item.start} — ${item.end} · 周报`;
export function visibleState(state) {
  const result = { ...state, trash: [] };
  for (const collection of collections) {
    result[collection] = (state[collection] || []).filter(item => !item.deletedAt);
    result.trash.push(...(state[collection] || []).filter(item => item.deletedAt).map(item => ({
      id: item.id, collection, title: titleFor(item), kind: item.kind, deletedAt: item.deletedAt,
    })));
  }
  result.trash.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return result;
}
function find(state, collection, itemId) {
  if (!collections.includes(collection)) throw new AppError('不支持删除这类内容');
  const item = state[collection].find(item => item.id === itemId);
  if (!item) throw new AppError('记录不存在', 404);
  return item;
}
export function moveToTrash(state, collection, itemId) {
  const item = find(state, collection, itemId);
  if (item.deletedAt) return { moved: 0 };
  const targets = [item];
  if (collection === 'sources') targets.push(...state.cards.filter(card => !card.deletedAt && card.evidence.some(e => e.sourceId === itemId)));
  const batch = id(); const deletedAt = now();
  for (const target of targets) {
    target.deletedAt = deletedAt; target.deletionBatch = batch;
    if (typeof target.revision === 'number') target.revision++;
  }
  return { moved: targets.length };
}
export function restoreFromTrash(state, collection, itemId) {
  const item = find(state, collection, itemId);
  if (!item.deletedAt) return { restored: 0, skipped: 0 };
  const canRestoreCard = card => card.evidence.every(e => state.sources.some(s => s.id === e.sourceId && !s.deletedAt));
  if (collection === 'cards' && !canRestoreCard(item)) throw new AppError('请先从回收站恢复这条经历引用的原始记录', 409);
  if (collection === 'sources' && state.sources.some(s => !s.deletedAt && s.hash === item.hash)) throw new AppError('相同原文已重新导入，无法重复恢复；原记录仍保留在回收站', 409);
  const batch = item.deletionBatch;
  const restore = target => { delete target.deletedAt; delete target.deletionBatch; if (typeof target.revision === 'number') target.revision++; };
  restore(item);
  let restored = 1; let skipped = 0;
  if (collection === 'sources') {
    for (const card of state.cards.filter(c => c.deletedAt && c.deletionBatch === batch)) {
      if (canRestoreCard(card)) { restore(card); restored++; } else skipped++;
    }
  }
  return { restored, skipped };
}
// Retention of active history must not silently purge recoverable items.
export function retainHistory(items, limit) {
  let activeCount = 0;
  return items.filter(item => item.deletedAt || ++activeCount <= limit);
}
