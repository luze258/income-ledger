import type { ImportPreview, Item, ParsedImport } from './types';
import defaultCategories from './defaultCategories.json';

export const DEFAULT_CATEGORIES: string[] = defaultCategories;

export function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const monthKey = (date = new Date()) => dateKey(date).slice(0, 7);
export const monthKeyOffset = (offset: number, date = new Date()) =>
  monthKey(new Date(date.getFullYear(), date.getMonth() + offset, 1));

export function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dateKey(parseDateKey(value)) === value;
}

export function yuanToCents(value: string | number) {
  const normalized = typeof value === 'number' ? String(value) : value.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) throw new Error(`金额“${value}”不正确`);
  const [whole, decimal = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`金额“${value}”超出范围`);
  return cents;
}

export const centsToYuan = (cents?: number) => ((cents ?? 0) / 100).toFixed(2);
export const money = (cents: number) =>
  `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type SaleCalculationInput = {
  quantity: number;
  unitSaleCents: number;
  unitPurchaseCents: number;
  shippingCents: number;
  shippingMode?: 'per_order' | 'per_unit';
  platformFeeValue: number;
  platformFeeMode?: 'fixed' | 'percent';
  otherFeeCents: number;
  otherFeeMode?: 'per_order' | 'per_unit';
};

/** 统一全量售出与部分售出的总额、费用和净收益口径。 */
export function calculateSale(input: SaleCalculationInput) {
  const shippingTotal =
    input.shippingCents * (input.shippingMode === 'per_unit' ? input.quantity : 1);
  const otherFeeTotal =
    input.otherFeeCents * (input.otherFeeMode === 'per_unit' ? input.quantity : 1);
  const saleCents = input.unitSaleCents * input.quantity;
  const platformFeeCents =
    input.platformFeeMode === 'percent'
      ? Math.round((saleCents * input.platformFeeValue) / 10_000)
      : input.platformFeeValue;
  return {
    saleCents,
    shippingCents: shippingTotal,
    platformFeeCents,
    otherFeeCents: otherFeeTotal,
    profitCents:
      saleCents -
      input.unitPurchaseCents * input.quantity -
      shippingTotal -
      platformFeeCents -
      otherFeeTotal,
  };
}

export type SaleFormCalculationInput = {
  quantity: number;
  unitPurchaseCents: number;
  unitSale: string;
  shipping: string;
  shippingMode?: 'per_order' | 'per_unit';
  platformFee: string;
  platformFeeMode?: 'fixed' | 'percent';
  otherFee: string;
  otherFeeMode?: 'per_order' | 'per_unit';
};

/** 从原始表单字段重新解析；提交时必须调用，不能使用渲染期的兜底结果。 */
export function calculateSaleFromForm(input: SaleFormCalculationInput) {
  const platformFeeValue =
    input.platformFeeMode === 'percent'
      ? percentageToBasisPoints(input.platformFee)
      : yuanToCents(input.platformFee);
  return calculateSale({
    quantity: input.quantity,
    unitSaleCents: yuanToCents(input.unitSale),
    unitPurchaseCents: input.unitPurchaseCents,
    shippingCents: yuanToCents(input.shipping),
    shippingMode: input.shippingMode,
    platformFeeValue,
    platformFeeMode: input.platformFeeMode,
    otherFeeCents: yuanToCents(input.otherFee),
    otherFeeMode: input.otherFeeMode,
  });
}

function percentageToBasisPoints(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error(`比例“${value}”不正确`);
  const result = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(result)) throw new Error(`比例“${value}”超出范围`);
  return result;
}

export function profitCents(item: Item) {
  const quantity = item.quantity ?? 1;
  return item.status === 'sold'
    ? (item.saleCents ?? 0) -
        item.purchaseCents * quantity -
        (item.shippingCents ?? 0) -
        (item.platformFeeCents ?? 0) -
        (item.otherFeeCents ?? 0)
    : 0;
}

export const marginPercent = (item: Item) =>
  item.purchaseCents
    ? (profitCents(item) / (item.purchaseCents * (item.quantity ?? 1))) * 100
    : null;

export const inventoryDays = (item: Item, now = new Date()) =>
  Math.max(0, Math.floor((now.getTime() - parseDateKey(item.purchaseDate).getTime()) / 86400000));

export function itemFingerprint(item: Item) {
  return [
    item.name.trim().toLocaleLowerCase('zh-CN'),
    item.category.trim(),
    item.purchaseCents,
    item.purchaseDate,
    item.saleDate ?? '',
  ].join('|');
}

export function buildImportPreview(
  source: ImportPreview['source'],
  mode: ImportPreview['mode'],
  parsed: ParsedImport,
  existing: Item[],
): ImportPreview {
  if (mode === 'replace')
    return {
      source,
      mode,
      items: parsed.items,
      added: parsed.items.length,
      skipped: 0,
      overwritten: existing.length,
      errors: parsed.errors,
      backup: parsed.backup,
    };
  const ids = new Set(existing.map((item) => item.id));
  const fingerprints = new Set(existing.map(itemFingerprint));
  const accepted: Item[] = [];
  const suspected: Item[] = [];
  const missingIds = new Set(parsed.missingIds ?? []);
  let skipped = 0;
  for (const item of parsed.items) {
    const fingerprint = itemFingerprint(item);
    if (ids.has(item.id)) {
      skipped += 1;
      continue;
    }
    if (missingIds.has(item.id) && fingerprints.has(fingerprint)) suspected.push(item);
    ids.add(item.id);
    fingerprints.add(fingerprint);
    accepted.push(item);
  }
  return {
    source,
    mode,
    items: accepted,
    added: accepted.length,
    skipped,
    overwritten: 0,
    errors: parsed.errors,
    suspected,
  };
}

function periodSummary(items: Item[], length: number) {
  const grouped = new Map<
    string,
    { period: string; revenueCents: number; profitCents: number; count: number }
  >();
  for (const item of items) {
    if (item.status !== 'sold' || !item.saleDate) continue;
    const period = item.saleDate.slice(0, length);
    const row = grouped.get(period) ?? { period, revenueCents: 0, profitCents: 0, count: 0 };
    row.revenueCents += item.saleCents ?? 0;
    row.profitCents += profitCents(item);
    row.count += 1;
    grouped.set(period, row);
  }
  return [...grouped.values()].sort((a, b) => b.period.localeCompare(a.period));
}

export const monthlySummary = (items: Item[]) => periodSummary(items, 7);
export const yearlySummary = (items: Item[]) => periodSummary(items, 4);
