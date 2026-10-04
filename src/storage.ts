import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_CATEGORIES } from './domain';
import { normalizeImportedItem } from './importExport';
import type { Backup, FeeTemplate, InventoryMovement, Item, ItemWrite } from './types';

const DATABASE_URL = 'sqlite:income-ledger.db';
const ITEMS_KEY = 'income-ledger-items';
const CATEGORIES_KEY = 'income-ledger-categories';
const TEMPLATES_KEY = 'income-ledger-fee-templates';
const INVENTORY_MOVEMENTS_KEY = 'income-ledger-inventory-movements';
export type StorageBackend = 'sqlite' | 'localStorage';

type ItemRow = {
  id: string;
  name: string;
  category: string;
  purchase_cents: number;
  quantity: number;
  purchase_date: string;
  status: Item['status'];
  expected_sale_cents: number | null;
  sale_cents: number | null;
  shipping_cents: number | null;
  platform_fee_cents: number | null;
  other_fee_cents: number | null;
  sale_date: string | null;
  platform: string | null;
  note: string | null;
  tags_json: string;
  image_data: string | null;
  created_at: number;
  deleted_at: number | null;
};

type InventoryMovementRow = {
  id: string;
  item_id: string;
  kind: InventoryMovement['kind'];
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  unit_cents: number | null;
  shipping_cents: number;
  shipping_mode: InventoryMovement['shippingMode'] | null;
  platform_fee_value: number;
  platform_fee_mode: InventoryMovement['platformFeeMode'] | null;
  other_fee_cents: number;
  other_fee_mode: InventoryMovement['otherFeeMode'] | null;
  note: string | null;
  created_at: number;
};

const ITEM_COLUMNS = `id,name,category,purchase_cents,quantity,purchase_date,status,expected_sale_cents,sale_cents,
  shipping_cents,platform_fee_cents,other_fee_cents,sale_date,platform,note,tags_json,created_at,deleted_at`;

export const isTauriRuntime = () =>
  typeof window !== 'undefined' &&
  Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
let databasePromise: Promise<Database> | null = null;
let activeBackend: StorageBackend = isTauriRuntime() ? 'sqlite' : 'localStorage';
const getDatabase = () => (databasePromise ??= Database.load(DATABASE_URL));

function readJson<T>(key: string, fallback: T): T {
  try {
    const bundled = localStorage.getItem('income-ledger-state-v2');
    if (bundled) {
      const value = JSON.parse(bundled);
      const field =
        key === ITEMS_KEY ? 'items' : key === CATEGORIES_KEY ? 'categories' : 'templates';
      if (field in value) return value[field] as T;
    }
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function commitLocal(data: Partial<Pick<Backup, 'items' | 'categories' | 'templates'>>) {
  const state = {
    items: readJson<Item[]>(ITEMS_KEY, []),
    categories: readJson<string[]>(CATEGORIES_KEY, DEFAULT_CATEGORIES),
    templates: readJson<FeeTemplate[]>(TEMPLATES_KEY, []),
    ...data,
  };
  localStorage.setItem('income-ledger-state-v2', JSON.stringify(state));
}
const writeJson = (key: string, value: unknown) =>
  commitLocal({
    [key === ITEMS_KEY ? 'items' : key === CATEGORIES_KEY ? 'categories' : 'templates']: value,
  });

export async function restoreBackup(backup: Backup) {
  const items: ItemWrite[] = backup.items.map((item) =>
    backup.imageDataByItemId &&
    Object.prototype.hasOwnProperty.call(backup.imageDataByItemId, item.id)
      ? { ...item, imageData: backup.imageDataByItemId[item.id] }
      : item,
  );
  const data = {
    items,
    categories: backup.categories,
    templates: backup.templates,
    inventoryMovements: backup.inventoryMovements ?? [],
  };
  if (activeBackend === 'sqlite') await invoke('commit_data', { data });
  else {
    const localItems: Item[] = items.map((item) =>
      item.imageData === null ? (({ imageData: _, ...rest }) => rest)(item) : item,
    );
    commitLocal({ items: localItems, categories: data.categories, templates: data.templates });
    localStorage.setItem(INVENTORY_MOVEMENTS_KEY, JSON.stringify(data.inventoryMovements));
  }
}

export async function changeItemCategories(ids: string[], category: string) {
  if (activeBackend === 'sqlite') {
    await invoke('change_item_categories', { ids, category });
  } else
    writeJson(
      ITEMS_KEY,
      readLocalItems().map((item) => (ids.includes(item.id) ? { ...item, category } : item)),
    );
}

function readLocalItems() {
  const values = readJson<unknown[]>(ITEMS_KEY, []);
  return values.flatMap((value) => {
    try {
      return [normalizeImportedItem(value)];
    } catch {
      return [];
    }
  });
}

function rowToItem(row: ItemRow): Item {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags_json || '[]');
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    purchaseCents: Number(row.purchase_cents),
    quantity: Number(row.quantity ?? 1),
    purchaseDate: row.purchase_date,
    status: row.status,
    expectedSaleCents: row.expected_sale_cents ?? undefined,
    saleCents: row.sale_cents ?? undefined,
    shippingCents: row.shipping_cents ?? undefined,
    platformFeeCents: row.platform_fee_cents ?? undefined,
    otherFeeCents: row.other_fee_cents ?? undefined,
    saleDate: row.sale_date ?? undefined,
    platform: row.platform ?? undefined,
    note: row.note ?? undefined,
    tags,
    imageData: row.image_data ?? undefined,
    createdAt: Number(row.created_at),
    deletedAt: row.deleted_at ?? undefined,
  };
}

function rowToMovement(row: InventoryMovementRow): InventoryMovement {
  return {
    id: row.id,
    itemId: row.item_id,
    kind: row.kind,
    quantityDelta: Number(row.quantity_delta),
    quantityBefore: Number(row.quantity_before),
    quantityAfter: Number(row.quantity_after),
    unitCents: row.unit_cents ?? undefined,
    shippingCents: Number(row.shipping_cents),
    shippingMode: row.shipping_mode ?? undefined,
    platformFeeValue: Number(row.platform_fee_value),
    platformFeeMode: row.platform_fee_mode ?? undefined,
    otherFeeCents: Number(row.other_fee_cents),
    otherFeeMode: row.other_fee_mode ?? undefined,
    note: row.note ?? undefined,
    createdAt: Number(row.created_at),
  };
}

async function loadSqliteItems() {
  const rows = await (
    await getDatabase()
  ).select<ItemRow[]>(
    `SELECT ${ITEM_COLUMNS}, NULL AS image_data FROM items ORDER BY created_at DESC, rowid DESC`,
  );
  return rows.map(rowToItem);
}

export async function loadItemImage(id: string): Promise<string | undefined> {
  if (activeBackend === 'sqlite') {
    const rows = await (
      await getDatabase()
    ).select<Array<{ image_data: string | null }>>('SELECT image_data FROM items WHERE id=$1', [
      id,
    ]);
    return rows[0]?.image_data ?? undefined;
  }
  return readLocalItems().find((item) => item.id === id)?.imageData;
}

/** 完整备份直接从权威存储读取，包含图片与回收站记录。 */
export async function loadBackupItems(): Promise<Item[]> {
  if (activeBackend !== 'sqlite') return readLocalItems();
  const rows = await (
    await getDatabase()
  ).select<ItemRow[]>(
    `SELECT ${ITEM_COLUMNS}, image_data FROM items ORDER BY created_at DESC, rowid DESC`,
  );
  return rows.map(rowToItem);
}

export async function loadInventoryMovements(): Promise<InventoryMovement[]> {
  if (activeBackend !== 'sqlite') return readJson<InventoryMovement[]>(INVENTORY_MOVEMENTS_KEY, []);
  const rows = await (
    await getDatabase()
  ).select<InventoryMovementRow[]>(
    'SELECT * FROM inventory_movements ORDER BY created_at DESC, rowid DESC',
  );
  return rows.map(rowToMovement);
}

export async function initializeStorage(): Promise<{
  items: Item[];
  categories: string[];
  templates: FeeTemplate[];
  inventoryMovements: InventoryMovement[];
  backend: StorageBackend;
  warning?: string;
}> {
  if (!isTauriRuntime())
    return {
      items: readLocalItems(),
      categories: readJson(CATEGORIES_KEY, DEFAULT_CATEGORIES),
      templates: readJson(TEMPLATES_KEY, []),
      inventoryMovements: readJson(INVENTORY_MOVEMENTS_KEY, []),
      backend: 'localStorage',
    };
  try {
    activeBackend = 'sqlite';
    const db = await getDatabase();
    const categoryRows = await db.select<{ name: string }[]>(
      'SELECT name FROM categories ORDER BY created_at, name',
    );
    const templateRows = await db.select<
      Array<{
        id: string;
        name: string;
        platform: string;
        shipping_cents: number;
        platform_fee_cents: number;
        other_fee_cents: number;
        created_at: number;
      }>
    >('SELECT * FROM fee_templates ORDER BY created_at DESC');
    return {
      items: await loadSqliteItems(),
      categories: categoryRows.map((row) => row.name),
      templates: templateRows.map((row) => ({
        id: row.id,
        name: row.name,
        platform: row.platform,
        shippingCents: row.shipping_cents,
        platformFeeCents: row.platform_fee_cents,
        otherFeeCents: row.other_fee_cents,
        createdAt: row.created_at,
      })),
      inventoryMovements: await loadInventoryMovements(),
      backend: activeBackend,
    };
  } catch (error) {
    console.error(error);
    throw new Error(`SQLite 数据库读取失败：${String(error)}`);
  }
}

export async function persistItem(item: ItemWrite) {
  if (activeBackend === 'sqlite') return invoke('upsert_item', { record: item });
  const items = readLocalItems();
  const index = items.findIndex((x) => x.id === item.id);
  const localItem: Item =
    item.imageData === null ? (({ imageData: _, ...rest }) => rest)(item) : item;
  if (index >= 0) items[index] = localItem;
  else items.unshift(localItem);
  writeJson(ITEMS_KEY, items);
}

/** 数量更新与库存日志在 SQLite 中由同一个事务提交。 */
export async function recordInventoryMovement(
  item: ItemWrite,
  movement: InventoryMovement,
  soldItem?: Item,
) {
  if (activeBackend === 'sqlite') {
    await invoke('record_inventory_movement', {
      record: item,
      movement,
      soldRecord: soldItem ?? null,
    });
    return;
  }
  const items = readLocalItems();
  const index = items.findIndex((value) => value.id === item.id);
  if (index < 0) throw new Error('找不到需要变动库存的商品');
  const localItem: Item =
    item.imageData === null ? (({ imageData: _, ...rest }) => rest)(item) : item;
  items[index] = localItem;
  if (soldItem) items.unshift(soldItem);
  const movements = readJson<InventoryMovement[]>(INVENTORY_MOVEMENTS_KEY, []);
  localStorage.setItem(INVENTORY_MOVEMENTS_KEY, JSON.stringify([movement, ...movements]));
  writeJson(ITEMS_KEY, items);
}

export async function replacePersistedItems(items: Item[]) {
  if (activeBackend === 'sqlite') {
    await invoke('commit_data', { data: { items } });
  } else writeJson(ITEMS_KEY, items);
}

export async function softDeleteItems(ids: string[]) {
  const deletedAt = Date.now();
  if (activeBackend === 'sqlite') {
    await invoke('set_items_deleted', { ids, deletedAt });
  } else
    writeJson(
      ITEMS_KEY,
      readLocalItems().map((item) => (ids.includes(item.id) ? { ...item, deletedAt } : item)),
    );
  return deletedAt;
}

export async function restoreItems(ids: string[]) {
  if (activeBackend === 'sqlite') {
    await invoke('set_items_deleted', { ids, deletedAt: null });
  } else
    writeJson(
      ITEMS_KEY,
      readLocalItems().map((item) =>
        ids.includes(item.id) ? { ...item, deletedAt: undefined } : item,
      ),
    );
}

export async function permanentlyDeleteItems(ids?: string[]) {
  if (activeBackend === 'sqlite') {
    await invoke('permanently_delete_items', { ids: ids ?? null });
  } else
    writeJson(
      ITEMS_KEY,
      readLocalItems().filter((item) => !item.deletedAt || (ids && !ids.includes(item.id))),
    );
}

export async function saveCategories(categories: string[]) {
  if (!categories.length) throw new Error('至少保留一个商品分类');
  if (activeBackend === 'sqlite') {
    await invoke('commit_data', { data: { categories } });
  } else writeJson(CATEGORIES_KEY, categories);
}

export async function saveFeeTemplates(templates: FeeTemplate[]) {
  if (activeBackend === 'sqlite') {
    await invoke('commit_data', { data: { templates } });
  } else writeJson(TEMPLATES_KEY, templates);
}
