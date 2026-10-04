import type { Backup, FeeTemplate, InventoryMovement, Item, ParsedImport } from './types';
import { centsToYuan, dateKey, isDateKey, marginPercent, profitCents, yuanToCents } from './domain';

const newId = () => crypto.randomUUID();
const text = (value: unknown) => (value == null ? '' : String(value).trim());
const optionalCents = (value: unknown) =>
  text(value) === '' ? undefined : yuanToCents(text(value));
const statusOf = (value: unknown): Item['status'] => {
  const status = text(value);
  if (status === '已售出' || status === 'sold') return 'sold';
  if (status === '库存中' || status === 'in_stock') return 'in_stock';
  throw new Error(`状态“${status}”不正确`);
};

function validateItem(item: Item) {
  if (!item.name || !item.category) throw new Error('商品名称或分类为空');
  if (!isDateKey(item.purchaseDate)) throw new Error('购入日期格式应为 YYYY-MM-DD');
  if (!Number.isSafeInteger(item.quantity ?? 1) || (item.quantity ?? 1) < 1)
    throw new Error('数量必须是大于 0 的整数');
  if (item.status === 'sold') {
    if (item.saleCents == null || !item.saleDate) throw new Error('已售出记录缺少卖出价或卖出日期');
    if (!isDateKey(item.saleDate)) throw new Error('卖出日期格式应为 YYYY-MM-DD');
    if (item.saleDate < item.purchaseDate) throw new Error('卖出日期不能早于购入日期');
  }
  return item;
}

export function normalizeImportedItem(value: unknown): Item {
  if (!value || typeof value !== 'object') throw new Error('记录不是对象');
  const source = value as Record<string, unknown>;
  const status = statusOf(source.status);
  const cents = (newKey: string, oldKey: string, required = false) => {
    const raw = source[newKey];
    if (raw != null && !(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0))
      throw new Error(`字段 ${newKey} 必须是非负整数分`);
    if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw;
    if (source[oldKey] != null) return yuanToCents(String(source[oldKey]));
    if (required) throw new Error(`缺少${oldKey}`);
    return undefined;
  };
  return validateItem({
    id: text(source.id) || newId(),
    name: text(source.name),
    category: text(source.category),
    purchaseCents: cents('purchaseCents', 'purchase', true)!,
    quantity:
      source.quantity == null
        ? 1
        : Number.isSafeInteger(source.quantity) && Number(source.quantity) >= 1
          ? Number(source.quantity)
          : (() => {
              throw new Error('字段 quantity 必须是大于 0 的整数');
            })(),
    purchaseDate: text(source.purchaseDate),
    status,
    expectedSaleCents: cents('expectedSaleCents', 'expectedSale'),
    saleCents: cents('saleCents', 'sale'),
    shippingCents: cents('shippingCents', 'shipping'),
    platformFeeCents: cents('platformFeeCents', 'platformFee'),
    otherFeeCents: cents('otherFeeCents', 'otherFee'),
    saleDate: text(source.saleDate) || undefined,
    platform: text(source.platform) || undefined,
    note: text(source.note) || undefined,
    tags: Array.isArray(source.tags)
      ? source.tags.map(text).filter(Boolean)
      : text(source.tags)
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
    imageData: text(source.imageData) || undefined,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : Date.now(),
    deletedAt: typeof source.deletedAt === 'number' ? source.deletedAt : undefined,
  });
}

export function parseJsonItems(input: string): ParsedImport {
  const document = JSON.parse(input);
  const isBackup = document?.format === 'income-ledger-backup';
  if (isBackup && document.version !== 1 && document.version !== 2)
    throw new Error('不支持的备份版本');
  const data = isBackup ? document.items : document;
  if (!Array.isArray(data)) throw new Error('JSON 顶层必须是记录数组');
  const items: Item[] = [];
  const errors: string[] = [];
  data.forEach((value, index) => {
    try {
      items.push(normalizeImportedItem(value));
    } catch (error) {
      errors.push(`第 ${index + 1} 条：${error instanceof Error ? error.message : '格式错误'}`);
    }
  });
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) errors.push(`重复记录ID：${item.id}`);
    ids.add(item.id);
  }
  let backup: Backup | undefined;
  if (isBackup) {
    if (
      !Array.isArray(document.categories) ||
      document.categories.some((c: unknown) => typeof c !== 'string' || !c.trim()) ||
      new Set(document.categories).size !== document.categories.length
    )
      errors.push('分类配置不正确或有重复');
    if (!Array.isArray(document.templates)) errors.push('费用模板配置不正确');
    else {
      const ids = new Set<string>();
      for (const t of document.templates) {
        if (
          !t ||
          typeof t.id !== 'string' ||
          !t.id ||
          ids.has(t.id) ||
          typeof t.name !== 'string' ||
          !t.name.trim() ||
          typeof t.platform !== 'string' ||
          !t.platform.trim() ||
          ![t.shippingCents, t.platformFeeCents, t.otherFeeCents, t.createdAt].every(
            (v) => Number.isSafeInteger(v) && v >= 0,
          )
        )
          errors.push('费用模板字段无效或 ID 重复');
        if (t?.id) ids.add(t.id);
      }
    }
    const inventoryMovements = document.version === 2 ? document.inventoryMovements : [];
    if (!Array.isArray(inventoryMovements)) errors.push('库存变动记录格式不正确');
    else {
      const movementIds = new Set<string>();
      for (const movement of inventoryMovements) {
        if (
          !movement ||
          typeof movement.id !== 'string' ||
          !movement.id ||
          movementIds.has(movement.id) ||
          typeof movement.itemId !== 'string' ||
          !['stock_in', 'adjustment', 'partial_sale'].includes(movement.kind) ||
          !Number.isSafeInteger(movement.quantityDelta) ||
          !Number.isSafeInteger(movement.quantityBefore) ||
          !Number.isSafeInteger(movement.quantityAfter) ||
          movement.quantityBefore < 0 ||
          movement.quantityAfter < 0 ||
          movement.quantityBefore + movement.quantityDelta !== movement.quantityAfter ||
          !Number.isSafeInteger(movement.shippingCents) ||
          !Number.isSafeInteger(movement.platformFeeValue) ||
          !Number.isSafeInteger(movement.otherFeeCents) ||
          !Number.isSafeInteger(movement.createdAt)
        )
          errors.push('库存变动记录字段无效或 ID 重复');
        if (movement?.id) movementIds.add(movement.id);
      }
    }
    const imageDataByItemId = document.imageDataByItemId;
    if (
      imageDataByItemId != null &&
      (typeof imageDataByItemId !== 'object' ||
        Array.isArray(imageDataByItemId) ||
        Object.values(imageDataByItemId).some(
          (value) => value !== null && typeof value !== 'string',
        ))
    )
      errors.push('图片备份字段格式不正确');
    if (!errors.length)
      backup = {
        format: 'income-ledger-backup',
        version: document.version,
        exportedAt: document.exportedAt,
        items,
        categories: document.categories,
        templates: document.templates,
        inventoryMovements: inventoryMovements as InventoryMovement[],
        imageDataByItemId: imageDataByItemId as Record<string, string | null> | undefined,
      };
  }
  return { items, errors, backup };
}

export function exportBackup(
  items: Item[],
  categories: string[],
  templates: FeeTemplate[],
  inventoryMovements: InventoryMovement[] = [],
) {
  const backup: Backup = {
    format: 'income-ledger-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    items,
    categories,
    templates,
    inventoryMovements,
    imageDataByItemId: Object.fromEntries(items.map((item) => [item.id, item.imageData ?? null])),
  };
  return JSON.stringify(backup, null, 2);
}

export function parseCsvRows(input: string) {
  const source = input.replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error('CSV 引号不完整');
  return rows;
}

const HEADERS = [
  '记录ID',
  '商品名称',
  '分类',
  '状态',
  '购入价',
  '数量',
  '购入日期',
  '预计售价',
  '销售平台',
  '卖出价',
  '卖出日期',
  '邮费',
  '平台手续费',
  '其他费用',
  '标签',
  '备注',
];
const REQUIRED_HEADERS = ['商品名称', '分类', '状态', '购入价', '购入日期'];

function normalizedCellText(value: unknown) {
  if (typeof value !== 'number') return text(value);
  const normalized = Math.round(value * 100) / 100;
  return Math.abs(value - normalized) < 1e-8 ? normalized.toFixed(2) : String(value);
}

function rowToItem(headers: string[], row: unknown[]): Item {
  const get = (name: string) => row[headers.indexOf(name)];
  const required = (name: string) => {
    if (!headers.includes(name)) throw new Error(`缺少“${name}”列`);
    return get(name);
  };
  const status = statusOf(required('状态'));
  return validateItem({
    id: text(get('记录ID')) || newId(),
    name: text(required('商品名称')),
    category: text(required('分类')),
    status,
    purchaseCents: yuanToCents(text(required('购入价'))),
    quantity: text(get('数量')) ? Number(text(get('数量'))) : 1,
    purchaseDate: text(required('购入日期')),
    expectedSaleCents: optionalCents(get('预计售价')),
    platform: text(get('销售平台')) || undefined,
    saleCents: optionalCents(get('卖出价')),
    saleDate: text(get('卖出日期')) || undefined,
    shippingCents: optionalCents(get('邮费')) ?? 0,
    platformFeeCents: optionalCents(get('平台手续费')) ?? 0,
    otherFeeCents: optionalCents(get('其他费用')) ?? 0,
    tags: text(get('标签'))
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    note: text(get('备注')) || undefined,
    createdAt: Date.now(),
  });
}

function parseRows(rows: unknown[][]): ParsedImport {
  if (rows.length < 2) throw new Error('文件中没有商品记录');
  const headers = rows[0].map(text);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length) throw new Error(`缺少必要列：${missingHeaders.join('、')}`);
  const items: Item[] = [];
  const errors: string[] = [];
  const missingIds: string[] = [];
  rows.slice(1).forEach((row, index) => {
    if (!row.some((value) => text(value))) return;
    try {
      const item = rowToItem(headers, row);
      items.push(item);
      if (!text(row[headers.indexOf('记录ID')])) missingIds.push(item.id);
    } catch (error) {
      errors.push(`第 ${index + 2} 行：${error instanceof Error ? error.message : '格式错误'}`);
    }
  });
  return { items, errors, missingIds };
}

export const parseCsvItems = (input: string) => parseRows(parseCsvRows(input));

export async function parseExcelItems(buffer: ArrayBuffer): Promise<ParsedImport> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('商品明细') ?? workbook.worksheets[0];
  if (!sheet) throw new Error('工作簿中没有工作表');
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[];
    rows.push(
      values
        .slice(1)
        .map((value) =>
          value instanceof Date
            ? dateKey(value)
            : typeof value === 'number'
              ? normalizedCellText(value)
              : value,
        ),
    );
  });
  return parseRows(rows);
}

export function exportCsv(items: Item[]) {
  const rows = items.map((item) => [
    item.id,
    item.name,
    item.category,
    item.status === 'sold' ? '已售出' : '库存中',
    centsToYuan(item.purchaseCents),
    item.quantity ?? 1,
    item.purchaseDate,
    item.expectedSaleCents == null ? '' : centsToYuan(item.expectedSaleCents),
    item.platform ?? '',
    item.saleCents == null ? '' : centsToYuan(item.saleCents),
    item.saleDate ?? '',
    centsToYuan(item.shippingCents),
    centsToYuan(item.platformFeeCents),
    centsToYuan(item.otherFeeCents),
    item.tags.join('，'),
    item.note ?? '',
    item.status === 'sold' ? centsToYuan(profitCents(item)) : '',
    item.status === 'sold'
      ? marginPercent(item) == null
        ? '不适用'
        : `${marginPercent(item)!.toFixed(2)}%`
      : '',
  ]);
  return (
    '\ufeff' +
    [[...HEADERS, '净收益', '成本利润率'], ...rows]
      .map((row) => row.map((value) => `"${String(value).split('"').join('""')}"`).join(','))
      .join('\r\n')
  );
}

export async function exportExcel(items: Item[]) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '收益账本';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('商品明细', { views: [{ state: 'frozen', ySplit: 1 }] });
  const extendedHeaders = [...HEADERS, '净收益', '成本利润率'];
  sheet.addRow(extendedHeaders);
  for (const item of items)
    sheet.addRow([
      item.id,
      item.name,
      item.category,
      item.status === 'sold' ? '已售出' : '库存中',
      item.purchaseCents / 100,
      item.quantity ?? 1,
      new Date(`${item.purchaseDate}T00:00:00`),
      item.expectedSaleCents == null ? null : item.expectedSaleCents / 100,
      item.platform ?? '',
      item.saleCents == null ? null : item.saleCents / 100,
      item.saleDate ? new Date(`${item.saleDate}T00:00:00`) : null,
      (item.shippingCents ?? 0) / 100,
      (item.platformFeeCents ?? 0) / 100,
      (item.otherFeeCents ?? 0) / 100,
      item.tags.join('，'),
      item.note ?? '',
      item.status === 'sold' ? profitCents(item) / 100 : null,
      item.status === 'sold'
        ? marginPercent(item) == null
          ? '不适用'
          : marginPercent(item)! / 100
        : null,
    ]);
  sheet.autoFilter = { from: 'A1', to: 'R1' };
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF376B4D' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  [5, 8, 10, 12, 13, 14, 17].forEach((column) => {
    sheet.getColumn(column).numFmt = '¥#,##0.00';
  });
  [7, 11].forEach((column) => {
    sheet.getColumn(column).numFmt = 'yyyy-mm-dd';
  });
  sheet.getColumn(18).numFmt = '0.00%';
  const widths = [38, 22, 14, 12, 14, 10, 14, 14, 16, 14, 14, 12, 14, 12, 20, 26, 14, 12];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.getColumn(16).alignment = { wrapText: true, vertical: 'top' };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
