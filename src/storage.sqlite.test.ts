import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: vi.fn() } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const record = {
  id: 'sqlite-item',
  name: 'SQLite 商品',
  category: '鞋',
  purchaseCents: 1200,
  quantity: 1,
  purchaseDate: '2026-01-01',
  status: 'in_stock' as const,
  tags: ['测试'],
  createdAt: 1,
};

describe('SQLite storage path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
  });

  it('loads lightweight rows, fetches images on demand, and delegates every write to Rust commands', async () => {
    const db = {
      select: vi.fn(async (query: string) => {
        if (query.includes('FROM categories')) return [{ name: '鞋' }];
        if (query.includes('FROM fee_templates')) return [];
        if (query.includes('WHERE id=$1')) return [{ image_data: 'data:image/png;base64,image' }];
        return [
          {
            id: record.id,
            name: record.name,
            category: record.category,
            purchase_cents: record.purchaseCents,
            quantity: record.quantity,
            purchase_date: record.purchaseDate,
            status: record.status,
            expected_sale_cents: null,
            sale_cents: null,
            shipping_cents: null,
            platform_fee_cents: null,
            other_fee_cents: null,
            sale_date: null,
            platform: null,
            note: null,
            tags_json: '["测试"]',
            image_data:
              query.includes('image_data FROM items') && !query.includes('NULL AS image_data')
                ? 'data:image/png;base64,complete-backup-image'
                : null,
            created_at: 1,
            deleted_at: null,
          },
        ];
      }),
    };
    vi.mocked(Database.load).mockResolvedValue(db as never);
    const storage = await import('./storage');

    const initial = await storage.initializeStorage();
    expect(initial.backend).toBe('sqlite');
    expect(initial.items[0].imageData).toBeUndefined();
    expect(db.select).toHaveBeenCalledWith(expect.stringContaining('NULL AS image_data'));
    await expect(storage.loadItemImage(record.id)).resolves.toContain('base64,image');
    const backupItems = await storage.loadBackupItems();
    expect(backupItems[0].imageData).toContain('complete-backup-image');
    expect(db.select).toHaveBeenCalledWith(expect.stringContaining('image_data FROM items'));

    await storage.persistItem(record);
    await storage.replacePersistedItems([record]);
    await storage.changeItemCategories([record.id], '衣服');
    await storage.softDeleteItems([record.id]);
    await storage.restoreItems([record.id]);
    await storage.permanentlyDeleteItems([record.id]);
    await storage.saveCategories(['鞋']);
    await storage.saveFeeTemplates([]);

    const names = vi.mocked(invoke).mock.calls.map(([name]) => name);
    expect(names).toEqual([
      'upsert_item',
      'commit_data',
      'change_item_categories',
      'set_items_deleted',
      'set_items_deleted',
      'permanently_delete_items',
      'commit_data',
      'commit_data',
    ]);
  });

  it('keeps undefined imageData absent while preserving an explicit null clear request', () => {
    expect(JSON.stringify({ imageData: undefined })).not.toContain('imageData');
    expect(JSON.stringify({ imageData: null })).toContain('"imageData":null');
  });

  it('reads reconciliation fields from SQLite and includes them in writes and backups', async () => {
    const paid = {
      ...record,
      status: 'sold' as const,
      saleDate: '2026-01-02',
      saleCents: 2000,
      platformFeeCents: 100,
      paymentStatus: 'received' as const,
      receivedDate: '2026-01-03',
      receivedCents: 1800,
      settlementExpectedCents: 1900,
      settlementReason: '额外平台费1元',
    };
    const db = {
      select: vi.fn(async (query: string) => {
        if (!query.includes('FROM items')) return [];
        expect(query).toContain('settlement_expected_cents');
        expect(query).toContain('settlement_reason');
        return [
          {
            id: paid.id,
            name: paid.name,
            category: paid.category,
            purchase_cents: paid.purchaseCents,
            quantity: 1,
            purchase_date: paid.purchaseDate,
            status: 'sold',
            sale_cents: 2000,
            platform_fee_cents: 100,
            sale_date: paid.saleDate,
            payment_status: 'received',
            received_date: paid.receivedDate,
            received_cents: 1800,
            settlement_expected_cents: 1900,
            settlement_reason: paid.settlementReason,
            tags_json: JSON.stringify(paid.tags),
            created_at: 1,
          },
        ];
      }),
    };
    vi.mocked(Database.load).mockResolvedValue(db as never);
    const storage = await import('./storage');
    expect((await storage.initializeStorage()).items[0]).toMatchObject(paid);
    expect((await storage.loadBackupItems())[0]).toMatchObject(paid);
    await storage.persistItem(paid);
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith('upsert_item', { record: paid });
  });

  it('restores explicit backup image states while preserving legacy image omissions', async () => {
    const storage = await import('./storage');
    const baseBackup = {
      format: 'income-ledger-backup' as const,
      version: 2 as const,
      exportedAt: '2026-10-04T00:00:00.000Z',
      items: [record],
      categories: ['鞋'],
      templates: [],
      inventoryMovements: [],
    };

    await storage.restoreBackup({ ...baseBackup, imageDataByItemId: { [record.id]: null } });
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith(
      'commit_data',
      expect.objectContaining({
        data: expect.objectContaining({ items: [expect.objectContaining({ imageData: null })] }),
      }),
    );

    await storage.restoreBackup({
      ...baseBackup,
      imageDataByItemId: { [record.id]: 'data:image/png;base64,restored' },
    });
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith(
      'commit_data',
      expect.objectContaining({
        data: expect.objectContaining({
          items: [expect.objectContaining({ imageData: 'data:image/png;base64,restored' })],
        }),
      }),
    );

    await storage.restoreBackup({ ...baseBackup, version: 1 });
    const calls = vi.mocked(invoke).mock.calls;
    const legacyItems = calls[calls.length - 1]?.[1] as {
      data: { items: Array<{ imageData?: string | null }> };
    };
    expect(legacyItems.data.items[0].imageData).toBeUndefined();
  });
});
