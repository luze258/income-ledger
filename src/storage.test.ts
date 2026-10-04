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
  beforeEach(() => memory.clear());

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
});
