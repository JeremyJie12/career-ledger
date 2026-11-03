import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../src/domain.js';
import { demoData } from '../examples/demo.js';
import { visibleState, moveToTrash, restoreFromTrash, retainHistory } from '../src/trash.js';
const fixture = () => ({ ...emptyState(), ...demoData() });

test('deleting a source cascades only to active dependent cards; restoration retains ownership', () => {
  const state = fixture(); const source = state.sources[0]; const card = state.cards[0];
  const result = moveToTrash(state, 'sources', source.id);
  assert.equal(result.moved, 2); assert.equal(visibleState(state).sources.length, 3);
  assert.equal(visibleState(state).cards.length, 3); assert.equal(visibleState(state).trash.length, 2);
  assert.equal(moveToTrash(state, 'sources', source.id).moved, 0);
  assert.equal(restoreFromTrash(state, 'sources', source.id).restored, 2);
  assert.equal(card.contribution, '负责'); assert.equal(card.status, 'confirmed'); assert.equal(card.revision, 3);
  assert.equal(visibleState(state).trash.length, 0);
});
test('restoring a source does not restore cards separately deleted earlier', () => {
  const state = fixture(); const card = state.cards[0];
  moveToTrash(state, 'cards', card.id);
  assert.equal(visibleState(state).sources.length, 4);
  moveToTrash(state, 'sources', state.sources[0].id);
  restoreFromTrash(state, 'sources', state.sources[0].id);
  assert.ok(card.deletedAt);
});
test('cards with multiple missing sources cannot be restored to broken evidence', () => {
  const state = fixture(); const card = state.cards[0];
  card.evidence.push({ sourceId: state.sources[1].id, quote: state.sources[1].content });
  moveToTrash(state, 'sources', state.sources[0].id);
  moveToTrash(state, 'sources', state.sources[1].id);
  assert.throws(() => restoreFromTrash(state, 'cards', card.id), /先从回收站恢复/);
  assert.equal(restoreFromTrash(state, 'sources', state.sources[0].id).skipped, 1);
  restoreFromTrash(state, 'sources', state.sources[1].id);
  assert.equal(restoreFromTrash(state, 'cards', card.id).restored, 1);
});
test('restoring a reimported source reports a conflict without discarding either copy', () => {
  const state = fixture(); const source = state.sources[0];
  moveToTrash(state, 'sources', source.id);
  state.sources.push({ ...source, id: 'new-copy', deletedAt: undefined, deletionBatch: undefined });
  assert.throws(() => restoreFromTrash(state, 'sources', source.id), /重新导入/);
  assert.ok(source.deletedAt); assert.equal(state.sources.length, 5);
});
test('invalid collection cannot mutate the ledger and retention does not purge trash', () => {
  const state = fixture(); const before = JSON.stringify(state);
  assert.throws(() => moveToTrash(state, '__proto__', 'any'), /不支持/);
  assert.equal(JSON.stringify(state), before);
  const items = [{ id: 'new' }, { id: 'trashed', deletedAt: '2026-11-03' }, { id: 'older' }];
  assert.deepEqual(retainHistory(items, 1).map(item => item.id), ['new', 'trashed']);
});
