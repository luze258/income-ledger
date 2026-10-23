import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: vi.fn() } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
  },
});

const record = {
  id: 'storage-item',
  name: '测试商品',
  category: '鞋',
  purchaseCents: 100,
  quantity: 1,
  purchaseDate: '2026-01-01',
  status: 'in_stock' as const,
  tags: [],
  createdAt: 1,
};

describe('local storage fallback', () => {
  beforeEach(() => {
    memory.clear();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('persists, soft-deletes, restores, and permanently deletes a record', async () => {
    const storage = await import('./storage');
    await storage.persistItem(record);
    expect((await storage.initializeStorage()).items).toEqual([record]);
    await storage.softDeleteItems([record.id]);
    expect((await storage.initializeStorage()).items[0].deletedAt).toBeTypeOf('number');
    await storage.restoreItems([record.id]);
    expect((await storage.initializeStorage()).items[0].deletedAt).toBeUndefined();
    await storage.softDeleteItems([record.id]);
    await storage.permanentlyDeleteItems([record.id]);
    expect((await storage.initializeStorage()).items).toEqual([]);
  });

  it('keeps at least one category while allowing an empty template list', async () => {
    const storage = await import('./storage');
    await expect(storage.saveCategories([])).rejects.toThrow('至少保留一个商品分类');
    await storage.saveCategories(['自定义分类']);
    await storage.saveFeeTemplates([]);
    const state = await storage.initializeStorage();
    expect(state.categories).toEqual(['自定义分类']);
    expect(state.templates).toEqual([]);
  });

  it('keeps settlement reconciliation through save, reload and full backup restore', async () => {
    const storage = await import('./storage');
    const { exportBackup, parseJsonItems } = await import('./importExport');
    const { defaultFinance, financeSummary } = await import('./finance');
    const paid = {
      ...record,
      status: 'sold' as const,
      saleCents: 500,
      platformFeeCents: 50,
      saleDate: '2026-01-02',
      paymentStatus: 'received' as const,
      receivedCents: 400,
      receivedDate: '2026-01-03',
      settlementExpectedCents: 450,
      settlementReason: '额外平台费50分',
    };
    await storage.saveFinance(defaultFinance(), [paid]);
    expect((await storage.initializeStorage()).items).toEqual([paid]);
    const parsed = parseJsonItems(
      exportBackup(await storage.loadBackupItems(), ['鞋'], [], [], await storage.loadFinance()),
    );
    expect(parsed.errors).toEqual([]);
    memory.clear();
    await storage.restoreBackup(parsed.backup!);
    const restored = (await storage.initializeStorage()).items;
    expect(restored).toEqual([paid]);
    expect(financeSummary(restored, await storage.loadFinance(), '2026-01').receivedProfit).toBe(
      300,
    );
  });
  it('allows missing keys on a genuinely empty ledger and reads legacy separate keys', async () => {
    const storage = await import('./storage');
    expect((await storage.initializeStorage()).items).toEqual([]);
    memory.set('income-ledger-items', JSON.stringify([record]));
    expect((await storage.initializeStorage()).items).toEqual([record]);
  });

  it.each(['{broken', '', 'null', '[]', '{"items":null}', '{"items":{}}'])(
    'rejects damaged bundled state %s without falling back or writing',
    async (raw) => {
      const storage = await import('./storage');
      memory.set('income-ledger-state-v2', raw);
      memory.set('income-ledger-items', JSON.stringify([record]));
      const before = new Map(memory);
      await expect(storage.initializeStorage()).rejects.toThrow('浏览器账本读取失败');
      await expect(storage.persistItem(record)).rejects.toThrow();
      await expect(storage.saveCategories(['新分类'])).rejects.toThrow();
      expect(memory).toEqual(before);
    },
  );

  it('blocks writes for the session after access denial, even if access later returns', async () => {
    const storage = await import('./storage');
    memory.set('income-ledger-state-v2', JSON.stringify({ items: [record] }));
    const before = new Map(memory);
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    await expect(storage.initializeStorage()).rejects.toThrow('access denied');
    read.mockRestore();
    await expect(storage.persistItem({ ...record, name: 'must not save' })).rejects.toThrow(
      '浏览器账本读取失败',
    );
    expect(memory).toEqual(before);
    vi.resetModules();
    const reloaded = await import('./storage');
    expect((await reloaded.initializeStorage()).items).toEqual([record]);
  });

  it('rejects malformed legacy JSON and invalid records instead of silently dropping them', async () => {
    let storage = await import('./storage');
    memory.set('income-ledger-items', '');
    await expect(storage.initializeStorage()).rejects.toThrow('浏览器账本读取失败');
    memory.set(
      'income-ledger-items',
      JSON.stringify([record, { ...record, id: 'bad', purchaseCents: -1 }]),
    );
    vi.resetModules();
    storage = await import('./storage');
    const before = new Map(memory);
    await expect(storage.initializeStorage()).rejects.toThrow('第 2 条');
    await expect(storage.saveCategories(['新分类'])).rejects.toThrow();
    expect(memory).toEqual(before);
  });
});
