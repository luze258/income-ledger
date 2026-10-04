import { describe, expect, it } from 'vitest';
import {
  buildImportPreview,
  calculateSale,
  calculateSaleFromForm,
  marginPercent,
  monthKeyOffset,
  monthlySummary,
  profitCents,
  yuanToCents,
} from './domain';
import type { Item } from './types';

const item = (overrides: Partial<Item> = {}): Item => ({
  id: '1',
  name: '商品',
  category: '鞋',
  purchaseCents: 10,
  purchaseDate: '2025-12-30',
  status: 'sold',
  saleCents: 30,
  shippingCents: 10,
  platformFeeCents: 2,
  otherFeeCents: 3,
  saleDate: '2026-01-02',
  tags: [],
  createdAt: 1,
  ...overrides,
});

describe('money calculations', () => {
  it('converts decimal yuan without floating point drift', () => {
    expect(yuanToCents('0.10')).toBe(10);
    expect(yuanToCents('0.29')).toBe(29);
  });
  it('calculates profit and margin from integer cents', () => {
    expect(profitCents(item())).toBe(5);
    expect(marginPercent(item())).toBe(50);
  });
  it('marks zero-cost margin as not applicable', () => {
    expect(marginPercent(item({ purchaseCents: 0 }))).toBeNull();
  });
  it('uses one calculation for multi-unit sales and every fee mode', () => {
    expect(
      calculateSale({
        quantity: 3,
        unitSaleCents: 1500,
        unitPurchaseCents: 1000,
        shippingCents: 200,
        shippingMode: 'per_unit',
        platformFeeValue: 500,
        platformFeeMode: 'percent',
        otherFeeCents: 100,
        otherFeeMode: 'per_order',
      }),
    ).toEqual({
      saleCents: 4500,
      shippingCents: 600,
      platformFeeCents: 225,
      otherFeeCents: 100,
      profitCents: 575,
    });
  });
  it('rejects blank or malformed sale fields before a transaction can be saved', () => {
    const base = {
      quantity: 2,
      unitPurchaseCents: 1000,
      unitSale: '15',
      shipping: '0',
      platformFee: '0',
      otherFee: '0',
    };
    expect(() => calculateSaleFromForm({ ...base, unitSale: '' })).toThrow('金额');
    expect(() => calculateSaleFromForm({ ...base, unitSale: '15x' })).toThrow('金额');
    expect(() => calculateSaleFromForm({ ...base, shipping: 'free' })).toThrow('金额');
    expect(() =>
      calculateSaleFromForm({ ...base, platformFee: 'five', platformFeeMode: 'percent' }),
    ).toThrow('比例');
  });
});

describe('period summaries', () => {
  it('handles month offsets across a year boundary', () => {
    expect(monthKeyOffset(1, new Date(2025, 11, 15))).toBe('2026-01');
    expect(monthKeyOffset(-1, new Date(2026, 0, 15))).toBe('2025-12');
  });
  it('groups sales into the correct year and month', () => {
    const rows = monthlySummary([item(), item({ id: '2', saleDate: '2025-12-31' })]);
    expect(rows.map((row) => row.period)).toEqual(['2026-01', '2025-12']);
  });
});

describe('import deduplication', () => {
  it('only skips records that have an existing ID', () => {
    const existing = [item()];
    const duplicate = item({ id: '2' });
    const unique = item({ id: '3', name: '另一件' });
    const preview = buildImportPreview(
      'csv',
      'merge',
      { items: [duplicate, unique], errors: [] },
      existing,
    );
    expect(preview.added).toBe(2);
    expect(preview.skipped).toBe(0);
    expect(preview.items.map((row) => row.id)).toEqual(['2', '3']);
  });
  it('flags fingerprint matches only when an import row had no original ID', () => {
    const preview = buildImportPreview(
      'csv',
      'merge',
      { items: [item({ id: 'generated' })], errors: [], missingIds: ['generated'] },
      [item()],
    );
    expect(preview.added).toBe(1);
    expect(preview.suspected?.map((row) => row.id)).toEqual(['generated']);
  });
});
