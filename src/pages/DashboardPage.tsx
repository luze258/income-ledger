import { type Page } from '../navigation';

import { financeSummary, financeReminders, paymentStatus, receiptReconciliation } from '../finance';

import { Boxes, TrendingUp, Wallet } from 'lucide-react';
import { money, monthKeyOffset, profitCents } from '../domain';

import type { Item, FinanceState } from '../types';
import { AsyncButton } from '../actions';

import { type ProductJump } from '../components/Products';

import { type LedgerPreferences } from '../preferences';

import { Card, Title, Empty } from '../components/Shared';

export function Dashboard({
  items: allItems,
  finance,
  onOpenAfterSales,
  onOpenReceipts,
  onNavigate,
  onOpenProducts,
  onDetails,
  onSell,
  onReceipt,
}: {
  onDetails: (item: Item) => void;
  onSell: (item: Item) => void;
  onReceipt: (item: Item) => void;
  items: Item[];
  finance: FinanceState;
  preferences: LedgerPreferences;
  onOpenAfterSales: () => void;
  onOpenReceipts: (filter: 'pending' | 'received' | 'unreconciled' | 'historical') => void;
  onNavigate: (page: Page) => void;
  onOpenProducts: (jump: ProductJump) => void;
}) {
  const items = allItems.filter((item) => !item.deletedAt);
  const summary = financeSummary(allItems, finance);
  const reminders = financeReminders(allItems);
  const target = Number(localStorage.getItem('income-ledger-profit-goal') || 0);
  const months = Array.from({ length: 6 }, (_, index) => {
    const key = monthKeyOffset(-5 + index);
    return {
      key,
      value: items
        .filter((item) => item.status === 'sold' && item.saleDate?.startsWith(key))
        .reduce((sum, item) => sum + profitCents(item), 0),
    };
  });
  const max = Math.max(1, ...months.map((month) => Math.abs(month.value)));
  const recent = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const waitingReturns = finance.afterSales.filter(
    (record) => record.kind === 'return' && !record.recoveredDate,
  ).length;
  return (
    <div className="phase2-dashboard">
      <div className="cards dashboard-metrics">
        <Card title="本月售出净收益" value={money(summary.soldProfit)} icon={<TrendingUp />} />
        <Card
          title="本月已确认回款净收益"
          value={money(summary.receivedProfit)}
          icon={<Wallet />}
        />
        <Card title="当前营运占用" value={money(summary.occupied)} icon={<Boxes />} />
      </div>
      <div className="metric-notes">
        <span>按售出日 · 含待回款</span>
        <span>按到账日及售后调整日</span>
        <span>库存成本 + 待回款本金</span>
      </div>
      <section className="phase2-secondary" aria-label="资金状态">
        <div>
          <small>库存成本</small>
          <b>{money(summary.inventoryCost)}</b>
          <span>当前 · 库存成本不是亏损</span>
        </div>
        <div>
          <small>新业务待回款</small>
          <b>{money(summary.pendingAmount)}</b>
          <span>预计结算 · {summary.pending.length} 条记录</span>
        </div>
        <div>
          <small>历史回款待确认</small>
          <b>{money(summary.historicalAmount)}</b>
          <span>预计结算 · {summary.historical.length} 条记录</span>
        </div>
        <div>
          <small>待核对回款收益</small>
          <b>{money(summary.unreconciledProfit)}</b>
          <span>本月到账 · 差额未解释</span>
        </div>
        <div>
          <small>现金余额</small>
          <b>{finance.cashCents == null ? '尚未核对' : money(finance.cashCents)}</b>
          <span>
            {finance.cashCheckedDate
              ? `人工核对 · ${finance.cashCheckedDate}`
              : '需人工核对 · 无核对日期'}
          </span>
        </div>
      </section>
      <div className="phase2-workspace">
        <section className="panel phase2-records">
          <div className="panel-head">
            <Title title="最近商品记录" note="最近添加的5条商品 · 金额单位：元" />
            <AsyncButton className="text-button" onClick={() => onNavigate('商品列表')}>
              查看全部 →
            </AsyncButton>
          </div>
          {recent.length ? (
            <div
              className="phase2-table-scroll"
              role="region"
              aria-label="最近商品记录，可横向滚动查看日期、金额及操作"
              tabIndex={0}
            >
              <p className="phase2-scroll-hint">左右滑动查看日期、金额及操作</p>
              <table>
                <thead>
                  <tr>
                    <th>商品 / 记录</th>
                    <th>数量</th>
                    <th>售出日期</th>
                    <th>成交 / 实际到账</th>
                    <th>回款状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((item) => {
                    const reconciliation = receiptReconciliation(item, finance);
                    const status =
                      item.status === 'in_stock'
                        ? '库存中'
                        : reconciliation.status === 'pending'
                          ? '差额待核对'
                          : paymentStatus(item) === 'pending'
                            ? '待回款'
                            : paymentStatus(item) === 'historical'
                              ? '历史回款待确认'
                              : '已回款';
                    return (
                      <tr key={item.id}>
                        <td>
                          <b>{item.name}</b>
                          <small>
                            {item.category}
                            {item.platform ? ` · ${item.platform}` : ''}
                          </small>
                        </td>
                        <td>{item.quantity ?? 1} 件</td>
                        <td>{item.saleDate ?? '—'}</td>
                        <td>
                          {item.status === 'sold' ? money(item.saleCents ?? 0) : '—'}
                          <small>
                            {item.status === 'sold' && paymentStatus(item) === 'received'
                              ? money(item.receivedCents ?? 0)
                              : '—'}
                          </small>
                        </td>
                        <td>
                          <span
                            className={`phase2-status ${status === '差额待核对' ? 'warning' : ''}`}
                          >
                            {status}
                          </span>
                        </td>
                        <td>
                          <div className="phase2-row-actions">
                            {item.status === 'in_stock' ? (
                              <AsyncButton className="outline" onClick={() => onSell(item)}>
                                售出
                              </AsyncButton>
                            ) : paymentStatus(item) !== 'received' ||
                              reconciliation.status === 'pending' ? (
                              <AsyncButton className="outline" onClick={() => onReceipt(item)}>
                                核对回款
                              </AsyncButton>
                            ) : null}
                            <AsyncButton
                              className="text-button"
                              aria-label={`查看商品详情：${item.name}`}
                              onClick={() => onDetails(item)}
                            >
                              详情
                            </AsyncButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="还没有商品记录，添加你的第一件商品吧" />
          )}
        </section>
        <section className="panel phase2-queue">
          <Title title="待办提醒" note="点击进入对应记录" />
          <div className="reminder-grid">
            <AsyncButton className="reminder-card" onClick={() => onOpenReceipts('pending')}>
              <span>新业务待回款</span>
              <b>{summary.pending.length}</b>
              <small>条待到账</small>
            </AsyncButton>
            <AsyncButton className="reminder-card" onClick={() => onOpenReceipts('unreconciled')}>
              <span>结算差额待核对</span>
              <b>{summary.unreconciled.length}</b>
              <small>条待核对</small>
            </AsyncButton>
            <AsyncButton className="reminder-card" onClick={() => onOpenProducts('occupied')}>
              <span>付款超过15天仍占用本金</span>
              <b>{reminders.overdue.length}</b>
              <small>未售库存及待回款</small>
            </AsyncButton>
            <AsyncButton className="reminder-card" onClick={() => onOpenProducts('oldStock')}>
              <span>库存超过30天</span>
              <b>{reminders.oldStock.length}</b>
              <small>条库存</small>
            </AsyncButton>
            <AsyncButton className="reminder-card" onClick={onOpenAfterSales}>
              <span>售后待收回</span>
              <b>{waitingReturns}</b>
              <small>条退货</small>
            </AsyncButton>
          </div>
          {summary.occupied > finance.capitalLimitCents && (
            <AsyncButton className="text-button loss" onClick={() => onNavigate('资金概览')}>
              营运占用本金超过上限，查看资金概览
            </AsyncButton>
          )}
        </section>
      </div>
      <p className="phase2-boundary">
        历史回款待确认独立保留，不计新业务待回款与营运占用。现金余额需人工核对，不据此推算可用资金。
      </p>
      <div className="goal-summary">
        <span>
          本月回款收益目标：
          {target ? `${money(summary.receivedProfit)} / ${money(target)}` : '未设置'}
        </span>
        <AsyncButton className="text-button" onClick={() => onNavigate('收益概览')}>
          调整目标
        </AsyncButton>
        {target > 0 && (
          <div className="goal-track">
            <i
              style={{
                width: `${Math.min(100, Math.max(0, (summary.receivedProfit / target) * 100))}%`,
              }}
            />
          </div>
        )}
      </div>
      <section className="panel chart-panel">
        <div className="panel-head">
          <Title title="售出收益趋势" note="最近6个月 · 按卖出日期，含待回款" />
          <AsyncButton className="outline" onClick={() => onNavigate('月度报表')}>
            查看报表
          </AsyncButton>
        </div>
        <div className="chart-bars">
          {months.map((month) => (
            <div className="chart-col" key={month.key}>
              <div className={month.value < 0 ? 'chart-value loss' : 'chart-value'}>
                {money(month.value)}
              </div>
              <div className="chart-track">
                <i style={{ height: `${Math.max(4, (Math.abs(month.value) / max) * 100)}%` }} />
              </div>
              <small>{month.key}</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
