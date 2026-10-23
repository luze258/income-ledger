import { describe, it, expect } from 'vitest';
import {
  defaultFinance,
  financeSummary,
  receivedProfit,
  splitReceipt,
  turnoverDays,
  validatePayment,
  receiptReconciliation,
  financeReminders,
} from './finance';
import { exportBackup, parseJsonItems } from './importExport';
import { profitCents } from './domain';
import type { AfterSale, Item } from './types';

const sale: Item = {
  id: 'sale',
  name: '商品',
  category: '鞋',
  purchaseCents: 40000,
  purchaseDate: '2026-10-13',
  quantity: 1,
  status: 'sold',
  saleDate: '2026-10-18',
  saleCents: 45000,
  platformFeeCents: 1000,
  shippingCents: 500,
  otherFeeCents: 0,
  paymentStatus: 'pending',
  tags: [],
  createdAt: 1,
};
describe('回款、周转和售后口径', () => {
  it.each([1, 2, 3])('兼容版本%s完整备份，不虚构结算原因或预计额', (version) => {
    const paid: Item = {
      ...sale,
      paymentStatus: 'received',
      receivedDate: '2026-10-23',
      receivedCents: 43000,
    };
    const parsed = parseJsonItems(
      JSON.stringify({
        format: 'income-ledger-backup',
        version,
        items: [paid],
        categories: ['鞋'],
        templates: [],
        inventoryMovements: [],
        finance: defaultFinance(),
      }),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.items[0].settlementExpectedCents).toBeUndefined();
    expect(parsed.items[0].settlementReason).toBeUndefined();
    expect(receiptReconciliation(parsed.items[0], parsed.backup!.finance!).status).toBe('pending');
    expect(parsed.items[0].receivedCents).toBe(43000);
  });
  it('正常到账按真实到账额计算，平台手续费只扣一次', () => {
    const received = validatePayment({
      ...sale,
      paymentStatus: 'received',
      receivedDate: '2026-10-23',
      receivedCents: 44000,
    });
    expect(receivedProfit(received)).toBe(3500);
    expect(turnoverDays(received)).toBe(10);
    expect(financeSummary([received], defaultFinance(), '2026-10').receivedProfit).toBe(3500);
  });
  it('跨月到账区分售出收益和已回款收益', () => {
    const received: Item = {
      ...sale,
      paymentStatus: 'received',
      receivedDate: '2026-11-01',
      receivedCents: 44000,
    };
    expect(financeSummary([received], defaultFinance(), '2026-10')).toMatchObject({
      soldProfit: 3500,
      receivedProfit: 0,
    });
    expect(financeSummary([received], defaultFinance(), '2026-11')).toMatchObject({
      soldProfit: 0,
      receivedProfit: 3500,
    });
  });
  it('部分到账拆分成本和费用且整数分总额守恒', () => {
    const batch = {
      ...sale,
      quantity: 3,
      saleCents: 135001,
      platformFeeCents: 3001,
      shippingCents: 501,
      otherFeeCents: 101,
    };
    const split = splitReceipt(batch, 1, 44000, '2026-10-23', 'paid');
    expect(split.map((i) => i.quantity)).toEqual([2, 1]);
    for (const key of ['saleCents', 'platformFeeCents', 'shippingCents', 'otherFeeCents'] as const)
      expect(split.reduce((s, i) => s + (i[key] ?? 0), 0)).toBe(batch[key]);
    expect(split.reduce((s, i) => s + profitCents(i), 0)).toBe(profitCents(batch));
    expect(financeSummary(split, defaultFinance(), '2026-10').pendingPrincipal).toBe(80000);
    expect(split[0].receivedDate).toBeUndefined();
  });
  it('退回确认之前不恢复库存，确认后按收回月份转回成本', () => {
    const a: AfterSale = {
      id: 'return',
      itemId: sale.id,
      kind: 'return',
      date: '2026-10-25',
      refundCents: 44000,
      lossCents: 1000,
      quantity: 1,
      reason: '退货',
    };
    const received: Item = {
      ...sale,
      paymentStatus: 'received',
      receivedDate: '2026-10-23',
      receivedCents: 44000,
    };
    const finance = { ...defaultFinance(), afterSales: [a] };
    expect(financeSummary([received], finance, '2026-10')).toMatchObject({
      inventoryCost: 0,
      receivedProfit: -41500,
    });
    const returned: Item = {
      ...sale,
      id: 'returned',
      status: 'in_stock',
      paymentStatus: undefined,
      saleDate: undefined,
    };
    const recovered = {
      ...finance,
      afterSales: [{ ...a, recoveredDate: '2026-11-02', returnedItemId: returned.id }],
    };
    expect(financeSummary([received, returned], recovered, '2026-11')).toMatchObject({
      inventoryCost: 40000,
      receivedProfit: 40000,
    });
    expect(financeSummary([sale, returned], recovered).pendingPrincipal).toBe(0);
  });
  it('部分退款不增加库存，结算内扣退款不会重复扣损', () => {
    const a: AfterSale = {
      id: 'refund',
      itemId: sale.id,
      kind: 'partial_refund',
      date: '2026-10-25',
      refundCents: 1000,
      lossCents: 0,
      quantity: 0,
      reason: '折让',
      deductedFromReceipt: true,
    };
    const received: Item = {
      ...sale,
      paymentStatus: 'received',
      receivedDate: '2026-10-26',
      receivedCents: 43000,
    };
    expect(
      financeSummary([received], { ...defaultFinance(), afterSales: [a] }, '2026-10'),
    ).toMatchObject({ receivedProfit: 2500, inventoryCost: 0 });
  });
  it('旧备份保留利润，历史回款不假定到账；新版完整往返', () => {
    const old = { ...sale, paymentStatus: undefined };
    const parsed = parseJsonItems(
      JSON.stringify({
        format: 'income-ledger-backup',
        version: 1,
        items: [old],
        categories: ['鞋'],
        templates: [],
      }),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.items[0]).toMatchObject({ paymentStatus: 'historical' });
    expect(parsed.items[0].receivedDate).toBeUndefined();
    expect(profitCents(parsed.items[0])).toBe(3500);
    expect(financeSummary(parsed.items, defaultFinance()).receivedProfit).toBe(0);
    const state = { ...defaultFinance(), cashCents: 12345, cashCheckedDate: '2026-10-13' };
    const backup = parseJsonItems(exportBackup(parsed.items, ['鞋'], [], [], state));
    expect(backup.errors).toEqual([]);
    expect(backup.backup?.finance).toEqual(state);
    expect(backup.items).toEqual(parsed.items);
  });
  it('拒绝缺金额、无效日期和保留到账字段的未到账记录', () => {
    expect(() => validatePayment({ ...sale, paymentStatus: 'received' })).toThrow();
    expect(() =>
      validatePayment({
        ...sale,
        paymentStatus: 'received',
        receivedDate: '2026-02-30',
        receivedCents: 0,
      }),
    ).toThrow();
    expect(() => validatePayment({ ...sale, receivedCents: 0 })).toThrow();
  });
  it('新版备份完整保存真实回款和独立售后记录', () => {
    const received: Item = {
      ...sale,
      paymentStatus: 'received',
      receivedDate: '2026-10-23',
      receivedCents: 44000,
    };
    const state = {
      ...defaultFinance(),
      afterSales: [
        {
          id: 'refund-backup',
          itemId: sale.id,
          kind: 'partial_refund' as const,
          date: '2026-10-24',
          refundCents: 1000,
          quantity: 0,
          lossCents: 200,
          reason: '折让',
        },
      ],
    };
    const result = parseJsonItems(exportBackup([received], ['鞋'], [], [], state));
    expect(result.errors).toEqual([]);
    expect(result.items).toEqual([received]);
    expect(result.backup?.finance).toEqual(state);
    expect(financeSummary(result.items, result.backup!.finance!, '2026-10').receivedProfit).toBe(
      2300,
    );
  });

  it('历史待确认单列，确认仍待回款后才占用营运额度', () => {
    const old: Item = { ...sale, id: 'old', paymentStatus: undefined };
    const inventory: Item = {
      ...sale,
      id: 'stock',
      status: 'in_stock',
      paymentStatus: undefined,
      quantity: 2,
    };
    const items = [sale, old, inventory, { ...sale, id: 'deleted', deletedAt: 1 }];
    const summary = financeSummary(items, defaultFinance(), '2026-10');
    expect(summary).toMatchObject({
      pendingAmount: 44000,
      historicalAmount: 44000,
      pendingPrincipal: 40000,
      historicalPrincipal: 40000,
      inventoryCost: 80000,
      occupied: 120000,
    });
    expect(summary.pending.map((i) => i.id)).toEqual(['sale']);
    expect(summary.historical.map((i) => i.id)).toEqual(['old']);
    const confirmed = financeSummary(
      [sale, { ...old, paymentStatus: 'pending' }, inventory],
      defaultFinance(),
    );
    expect(confirmed).toMatchObject({
      historicalAmount: 0,
      historicalPrincipal: 0,
      pendingAmount: 88000,
      pendingPrincipal: 80000,
      occupied: 160000,
    });
  });

  it('历史退回成本只列入恢复库存，不重复列入历史本金', () => {
    const old: Item = { ...sale, paymentStatus: 'historical' };
    const returned: Item = {
      ...sale,
      id: 'returned',
      status: 'in_stock',
      paymentStatus: undefined,
    };
    const finance = {
      ...defaultFinance(),
      afterSales: [
        {
          id: 'r',
          itemId: sale.id,
          kind: 'return' as const,
          date: '2026-10-20',
          refundCents: 44000,
          quantity: 1,
          lossCents: 0,
          reason: '退货',
          recoveredDate: '2026-10-21',
          returnedItemId: returned.id,
        },
      ],
    };
    expect(financeSummary([old, returned], finance)).toMatchObject({
      historicalPrincipal: 0,
      pendingPrincipal: 0,
      inventoryCost: 40000,
      occupied: 40000,
    });
  });

  it('15天边界涵盖未售和待回款，排除已到账、历史及已删除记录', () => {
    const inventory: Item = {
      ...sale,
      id: 'stock',
      status: 'in_stock',
      paymentStatus: undefined,
      purchaseDate: '2026-10-02',
    };
    const pending = { ...sale, id: 'pending', purchaseDate: '2026-10-02' };
    const items: Item[] = [
      inventory,
      pending,
      { ...inventory, id: '15days', purchaseDate: '2026-10-03' },
      { ...inventory, id: 'old-stock', purchaseDate: '2026-09-17' },
      { ...sale, id: 'received', paymentStatus: 'received', purchaseDate: '2026-09-01' },
      { ...sale, id: 'historical', paymentStatus: undefined, purchaseDate: '2026-09-01' },
      { ...inventory, id: 'deleted', deletedAt: 1 },
    ];
    const reminders = financeReminders(items, '2026-10-18');
    expect(reminders.overdue.map((i) => i.id)).toEqual(['stock', 'pending', 'old-stock']);
    expect(reminders.oldStock.map((i) => i.id)).toEqual(['old-stock']);
  });

  it.each([43000, 45000, 0])('到账 %s 分的差额留待核对，补原因后按到账月份计入收益', (amount) => {
    const [received] = splitReceipt(sale, 1, amount, '2026-11-01', 'unused');
    expect(received.settlementExpectedCents).toBe(44000);
    expect(receiptReconciliation(received, defaultFinance())).toMatchObject({
      expectedCents: 44000,
      differenceCents: amount - 44000,
      status: 'pending',
    });
    expect(financeSummary([received], defaultFinance(), '2026-11')).toMatchObject({
      receivedProfit: 0,
      unreconciledProfit: amount - 40500,
      occupied: 0,
    });
    const [explained] = splitReceipt(
      received,
      1,
      amount,
      '2026-11-01',
      'unused',
      ' 平台调整，已核对 ',
    );
    expect(explained.settlementReason).toBe('平台调整，已核对');
    expect(receiptReconciliation(explained, defaultFinance()).status).toBe('explained');
    expect(financeSummary([explained], defaultFinance(), '2026-11')).toMatchObject({
      receivedProfit: amount - 40500,
      unreconciledProfit: 0,
    });
    expect(financeSummary([explained], defaultFinance(), '2026-10').receivedProfit).toBe(0);
  });

  it('旧已到账记录有差额不会假定已核对，空白原因仍待核对', () => {
    const received: Item = {
      ...sale,
      paymentStatus: 'received',
      receivedDate: '2026-10-23',
      receivedCents: 43000,
      settlementReason: '   ',
    };
    expect(receiptReconciliation(received, defaultFinance()).status).toBe('pending');
    expect(financeSummary([received], defaultFinance(), '2026-10').unreconciled).toHaveLength(1);
  });

  it('部分到账按拆分后的成交额和费用核对，保留分币精度与剩余记录', () => {
    const batch = { ...sale, quantity: 3, saleCents: 135002, platformFeeCents: 3001 };
    const [remainder, paid] = splitReceipt(batch, 1, 44001, '2026-10-23', 'paid');
    expect(receiptReconciliation(paid, defaultFinance())).toMatchObject({
      expectedCents: 44001,
      status: 'matched',
    });
    expect(remainder.settlementExpectedCents).toBeUndefined();
    expect(remainder.settlementReason).toBeUndefined();
    expect(financeSummary([remainder, paid], defaultFinance()).pendingPrincipal).toBe(80000);
  });

  it('已扣退款可解释结算差额，不重复计损；新版备份保留核对额和原因', () => {
    const [received] = splitReceipt(sale, 1, 43000, '2026-10-26', 'unused');
    const state = {
      ...defaultFinance(),
      afterSales: [
        {
          id: 'refund',
          itemId: received.id,
          kind: 'partial_refund' as const,
          date: '2026-10-25',
          refundCents: 1000,
          quantity: 0,
          lossCents: 0,
          reason: '折让',
          deductedFromReceipt: true,
        },
      ],
    };
    expect(receiptReconciliation(received, state)).toMatchObject({
      expectedCents: 43000,
      status: 'matched',
    });
    expect(financeSummary([received], state, '2026-10').receivedProfit).toBe(2500);
    const explained = { ...received, receivedCents: 42000, settlementReason: '另扣平台调整费10元' };
    const backup = parseJsonItems(exportBackup([explained], ['鞋'], [], [], state));
    expect(backup.errors).toEqual([]);
    expect(backup.backup?.version).toBe(4);
    expect(backup.items).toEqual([explained]);
    expect(receiptReconciliation(backup.items[0], backup.backup!.finance!)).toMatchObject({
      expectedCents: 43000,
      differenceCents: -1000,
      status: 'explained',
    });
  });

  it('拒绝无效预计结算额、非文本原因和未到账核对信息', () => {
    const received = {
      ...sale,
      paymentStatus: 'received' as const,
      receivedDate: '2026-10-23',
      receivedCents: 44000,
    };
    expect(() => validatePayment({ ...received, settlementExpectedCents: -1 })).toThrow();
    expect(() =>
      validatePayment({ ...received, settlementReason: 12 as unknown as string }),
    ).toThrow();
    expect(() => validatePayment({ ...sale, settlementExpectedCents: 44000 })).toThrow();
  });
});
