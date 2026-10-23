import { describe, expect, it } from 'vitest';
import {
  exportBackup,
  exportExcel,
  parseCsvItems,
  parseExcelItems,
  parseJsonItems,
} from './importExport';

describe('CSV parsing', () => {
  it('keeps valid rows and reports invalid row numbers', () => {
    const csv =
      '记录ID,商品名称,分类,状态,购入价,购入日期,卖出价,卖出日期\n1,商品A,鞋,已售出,10.20,2026-01-01,20.50,2026-01-02\n2,商品B,鞋,错误,5,2026-01-01,,\n';
    const result = parseCsvItems(csv);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].purchaseCents).toBe(1020);
    expect(result.items[0].quantity).toBe(1);
    expect(result.errors[0]).toContain('第 3 行');
  });
  it('supports quoted commas', () => {
    const csv = '记录ID,商品名称,分类,状态,购入价,购入日期\n1,"商品,A",鞋,库存中,1.00,2026-01-01';
    expect(parseCsvItems(csv).items[0].name).toBe('商品,A');
  });
  it('reports missing required headers once before reading rows', () => {
    expect(() => parseCsvItems('记录ID,商品名称\n1,商品A\n2,商品B')).toThrow('缺少必要列');
  });
});

describe('JSON validation', () => {
  it('migrates old yuan fields into cents', () => {
    const result = parseJsonItems(
      JSON.stringify([
        {
          id: '1',
          name: '旧数据',
          category: '鞋',
          purchase: 0.1,
          purchaseDate: '2026-01-01',
          status: 'in_stock',
        },
      ]),
    );
    expect(result.items[0].purchaseCents).toBe(10);
  });
  it('reports invalid dates without discarding valid records', () => {
    const result = parseJsonItems(
      JSON.stringify([
        {
          id: '1',
          name: '好',
          category: '鞋',
          purchaseCents: 100,
          purchaseDate: '2026-01-01',
          status: 'in_stock',
        },
        {
          id: '2',
          name: '坏',
          category: '鞋',
          purchaseCents: 100,
          purchaseDate: '2026-99-99',
          status: 'in_stock',
        },
      ]),
    );
    expect(result.items).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
  it('round-trips a complete backup including settings', () => {
    const item = {
      id: 'backup-item',
      name: '完整备份商品',
      category: '鞋',
      purchaseCents: 100,
      purchaseDate: '2026-01-01',
      status: 'in_stock' as const,
      tags: [],
      imageData: 'data:image/png;base64,complete-image',
      createdAt: 1,
    };
    const templates = [
      {
        id: 'template',
        name: '平台模板',
        platform: '平台',
        shippingCents: 1,
        platformFeeCents: 2,
        otherFeeCents: 3,
        createdAt: 1,
      },
    ];
    const movements = [
      {
        id: 'movement',
        itemId: item.id,
        kind: 'stock_in' as const,
        quantityDelta: 2,
        quantityBefore: 1,
        quantityAfter: 3,
        shippingCents: 0,
        platformFeeValue: 0,
        otherFeeCents: 0,
        createdAt: 2,
      },
    ];
    const result = parseJsonItems(exportBackup([item], ['鞋'], templates, movements));
    expect(result.errors).toEqual([]);
    expect(result.backup?.categories).toEqual(['鞋']);
    expect(result.backup?.templates).toEqual(templates);
    expect(result.backup?.items[0].imageData).toBe('data:image/png;base64,complete-image');
    expect(result.backup?.version).toBe(4);
    expect(result.backup?.inventoryMovements).toEqual(movements);
  });
});

describe('Excel round trip', () => {
  it('exports typed currency and dates that can be imported again', async () => {
    const source = {
      id: 'x1',
      name: 'Excel 商品',
      category: '鞋',
      purchaseCents: 1234,
      purchaseDate: '2026-01-01',
      status: 'sold' as const,
      saleCents: 2000,
      shippingCents: 100,
      platformFeeCents: 50,
      otherFeeCents: 0,
      saleDate: '2026-01-03',
      tags: ['测试'],
      createdAt: 1,
    };
    const bytes = await exportExcel([source]);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const result = await parseExcelItems(buffer);
    expect(result.errors).toEqual([]);
    expect(result.items[0].purchaseCents).toBe(1234);
    expect(result.items[0].saleDate).toBe('2026-01-03');
  }, 20_000);
  it('accepts insignificant Excel floating-point noise but rejects three-decimal amounts', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('商品明细');
    sheet.addRow(['记录ID', '商品名称', '分类', '状态', '购入价', '购入日期']);
    sheet.addRow([
      'noise',
      '浮点商品',
      '鞋',
      '库存中',
      1.00000000001,
      new Date('2026-01-01T00:00:00'),
    ]);
    const bytes = await workbook.xlsx.writeBuffer();
    const result = await parseExcelItems(bytes as ArrayBuffer);
    expect(result.errors).toEqual([]);
    expect(result.items[0].purchaseCents).toBe(100);
  }, 20_000);
});
