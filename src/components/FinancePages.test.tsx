import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FinancePanel } from './FinancePanel';
import { defaultFinance } from '../finance';
import type { Item } from '../types';

vi.mock('../storage', () => ({ loadItemImage: vi.fn() }));
const sale: Item = {
  id: 'pending',
  name: '等待到账的交易',
  category: '电子产品',
  tags: [],
  quantity: 1,
  purchaseCents: 10000,
  purchaseDate: '2026-09-01',
  status: 'sold',
  saleCents: 15000,
  saleDate: '2026-10-01',
  paymentStatus: 'pending',
  createdAt: 1,
};
const items: Item[] = [
  sale,
  { ...sale, id: 'history', name: '历史待确认的交易', paymentStatus: 'historical' },
  {
    ...sale,
    id: 'received',
    name: '已到账有差额的交易',
    paymentStatus: 'received',
    receivedDate: '2026-10-02',
    receivedCents: 14000,
  },
];
const render = (props: Partial<Parameters<typeof FinancePanel>[0]> = {}) =>
  renderToStaticMarkup(
    <FinancePanel items={items} finance={defaultFinance()} onSave={async () => {}} {...props} />,
  );

describe('资金与回款页面边界', () => {
  it('资金概览不渲染完整业务记录', () => {
    const html = render({ view: 'overview' });
    expect(html).toContain('营运占用本金（不含历史待确认）');
    for (const item of items) expect(html).not.toContain(item.name);
    expect(html).not.toContain('标记到账');
  });
  it('历史交易和差额核对只在所选视图中展示', () => {
    const pending = render({ view: 'receipts', filter: 'pending' });
    expect(pending).toContain(sale.name);
    expect(pending).not.toContain(items[1].name);
    expect(pending).not.toContain(items[2].name);
    const historical = render({ view: 'receipts', filter: 'historical' });
    expect(historical).toContain(items[1].name);
    expect(historical).not.toContain(sale.name);
    const differences = render({ view: 'receipts', filter: 'unreconciled' });
    expect(differences).toContain(items[2].name);
    expect(differences).toContain('核对结算差额');
    expect(differences).not.toContain(sale.name);
  });
  it('回款列表分页限制初次渲染记录数', () => {
    const many = Array.from({ length: 23 }, (_, index) => ({
      ...sale,
      id: `sale-${index}`,
      name: `分页交易-${index}-结束`,
    }));
    const html = render({ items: many, view: 'receipts', filter: 'pending', pageSize: 10 });
    expect(html).toContain('分页交易-0-结束');
    expect(html).toContain('分页交易-9-结束');
    expect(html).not.toContain('分页交易-10-结束');
    expect(html).toContain('下一页');
  });
  it('售后页面保留退货恢复库存入口，并可单独查看待收回', () => {
    const finance = {
      ...defaultFinance(),
      afterSales: [
        {
          id: 'return',
          itemId: sale.id,
          kind: 'return' as const,
          date: '2026-10-02',
          quantity: 1,
          refundCents: 1000,
          lossCents: 0,
          reason: '待收回原因',
          deductedFromReceipt: false,
        },
        {
          id: 'refund',
          itemId: sale.id,
          kind: 'partial_refund' as const,
          date: '2026-10-02',
          quantity: 1,
          refundCents: 500,
          lossCents: 0,
          reason: '已完成部分退款',
          deductedFromReceipt: false,
        },
      ],
    };
    const html = render({ finance, view: 'afterSales', initialAfterFilter: 'waiting' });
    expect(html).toContain('待收回原因');
    expect(html).toContain('确认收回');
    expect(html).not.toContain('已完成部分退款');
    expect(html).not.toContain('标记到账');
  });
});
