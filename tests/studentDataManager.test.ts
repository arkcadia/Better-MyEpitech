import { describe, expect, it, vi } from 'vitest';
import { StudentDataManager, timetableWindow } from '../src/application/studentDataManager';
import { deferred } from './helpers';
import type { StudentDataSnapshot } from '../src/domain/studentData';

const empty = { complete: true, collectedAt: '2026-10-23T00:00:00.000Z', projects: [], events: [], warnings: [], range: { from: '2026-10-23T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' } } as StudentDataSnapshot;

describe('account-scoped student data collection', () => {
  it('does not collect without a verified account', async () => {
    const collect = vi.fn(); const manager = new StudentDataManager({ collect });
    await manager.refresh(empty.range.from, empty.range.to);
    expect(collect).not.toHaveBeenCalled();
  });
  it('discards late data after disconnect or account switch', async () => {
    const pending = deferred<StudentDataSnapshot>();
    const manager = new StudentDataManager({ collect: () => pending.promise });
    manager.setAccount('one@example.invalid');
    const loading = manager.refresh(empty.range.from, empty.range.to);
    manager.setAccount('two@example.invalid'); pending.resolve(empty); await loading;
    expect(manager.getSnapshot()).toMatchObject({ account: 'two@example.invalid', data: null, status: 'idle' });
  });
  it('discards an obsolete date range even when its network call ignores cancellation', async () => {
    const old = deferred<StudentDataSnapshot>();
    const collect = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(empty);
    const manager = new StudentDataManager({ collect }); manager.setAccount('one@example.invalid');
    const loading = manager.refresh('2026-10-01', '2026-10-15');
    await manager.refresh(empty.range.from, empty.range.to);
    old.resolve({ ...empty, warnings: ['obsolete'] }); await loading;
    expect(manager.getSnapshot().data).toEqual(empty);
  });
  it('drops private data on suspend', async () => {
    const manager = new StudentDataManager({ collect: async () => empty });
    manager.setAccount('one@example.invalid'); await manager.refresh(empty.range.from, empty.range.to);
    manager.suspend(); expect(manager.getSnapshot()).toMatchObject({ account: null, data: null });
  });
  it('does not expose a raw provider exception', async () => {
    const manager = new StudentDataManager({ collect: async () => { throw Error('private response'); } });
    manager.setAccount('one@example.invalid'); await manager.refresh(empty.range.from, empty.range.to);
    expect(manager.getSnapshot().issue).not.toContain('private response');
  });
  it('uses contiguous explicit UTC ranges across daylight saving boundaries', () => {
    const now = new Date('2026-10-23T13:00:00Z');
    const a = timetableWindow(0, now), b = timetableWindow(1, now);
    expect(a).toEqual({ from: '2026-10-23T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' });
    expect(a.to).toBe(b.from);
  });
});
