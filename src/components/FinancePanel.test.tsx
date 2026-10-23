import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinancePanel } from './FinancePanel';
import { defaultFinance } from '../finance';
import type { Item } from '../types';

vi.mock('../storage', () => ({ loadItemImage: vi.fn() }));

describe('回款首页展示', () => {
  afterEach(() => vi.useRealTimers());

  it('分别展示新业务、历史和差额待核对，未售库存触发15天提醒', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00+08:00'));
    const sale: Item = {
      id: 'sale',
      name: '新业务商品',
      category: '鞋',
      purchaseCents: 40000,
      quantity: 1,
      purchaseDate: '2026-10-02',
      status: 'sold',
      saleCents: 45000,
      platformFeeCents: 1000,
      saleDate: '2026-10-10',
      paymentStatus: 'pending',
      tags: [],
      createdAt: 1,
    };
    const items: Item[] = [
      sale,
      { ...sale, id: 'old', name: '历史商品', paymentStatus: 'historical' },
      { ...sale, id: 'stock', name: '未售商品', status: 'in_stock', paymentStatus: undefined },
      {
        ...sale,
        id: 'paid',
        name: '差额商品',
        paymentStatus: 'received',
        receivedDate: '2026-10-15',
        receivedCents: 43000,
      },
    ];
    const html = renderToStaticMarkup(
      <FinancePanel items={items} finance={defaultFinance()} onSave={async () => {}} />,
    );
    expect(html).toContain('新业务待回款 · 1 条');
    expect(html).toContain('历史回款待确认 · 1 条');
    expect(html).toContain('结算差额待核对 · 1 条');
    expect(html).toContain('付款超过15天仍占用本金：2条');
    expect(html).toContain('差额商品');
    expect(html).toContain('核对结算差额');
    expect(html).toContain('差额（实际－预计）¥-10.00');
    expect(html).not.toContain('待回款金额（含历史待确认）');
  });
});
