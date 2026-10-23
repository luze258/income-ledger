import React, { useState } from 'react';

import { Package, TrendingUp, Wallet } from 'lucide-react';
import {
  centsToYuan,
  dateKey,
  inventoryDays,
  money,
  monthlySummary,
  parseDateKey,
  profitCents,
  yearlySummary,
  yuanToCents,
} from '../domain';

import type { Item } from '../types';
import { AsyncButton } from '../actions';

import { Card, Title, Empty, FormInput, categoryColor } from '../components/Shared';

export function ProfitGoal({ profit }: { profit: number }) {
  const [target, setTarget] = useState(() =>
    Number(localStorage.getItem('income-ledger-profit-goal') || 0),
  );
  const [editing, setEditing] = useState(false);
  const percent = target > 0 ? Math.min(100, Math.max(0, (profit / target) * 100)) : 0;
  return (
    <section className="panel goal-panel">
      <div className="panel-title">
        <div>
          <h2>本月利润目标（已回款净收益）</h2>
          <span>{target ? `已完成 ${percent.toFixed(0)}%` : '设置目标后显示完成进度'}</span>
        </div>
        <AsyncButton className="outline" onClick={() => setEditing((value) => !value)}>
          {editing ? '完成' : '设置目标'}
        </AsyncButton>
      </div>
      {editing && (
        <input
          aria-label="本月利润目标（元）"
          type="number"
          min="0"
          defaultValue={target ? centsToYuan(target) : ''}
          onChange={(event) => {
            const value = yuanToCents(event.target.value || '0');
            setTarget(value);
            localStorage.setItem('income-ledger-profit-goal', String(value));
          }}
        />
      )}
      <div className="goal-track">
        <i style={{ width: `${percent}%` }} />
      </div>
      <b>
        {money(profit)} / {target ? money(target) : '未设置'}
      </b>
    </section>
  );
}

export function Stats({
  items,
  view,
}: {
  items: Item[];
  view: 'overview' | 'month' | 'year' | 'ranking';
}) {
  const sold = items.filter((x) => x.status === 'sold');
  const monthly = monthlySummary(sold);
  const yearly = yearlySummary(sold);
  const revenue = sold.reduce((sum, x) => sum + (x.saleCents ?? 0), 0);
  const total = sold.reduce((sum, x) => sum + profitCents(x), 0);
  const profitRanking = [...sold].sort((a, b) => profitCents(b) - profitCents(a)).slice(0, 10);
  const stagnant = items
    .filter((x) => x.status === 'in_stock')
    .sort((a, b) => inventoryDays(b) - inventoryDays(a))
    .slice(0, 10);
  const platformGroups = [...new Set(sold.map((item) => item.platform || '未填写平台'))]
    .map((platform) => {
      const rows = sold.filter((item) => (item.platform || '未填写平台') === platform);
      return {
        platform,
        count: rows.length,
        value: rows.reduce((sum, item) => sum + profitCents(item), 0),
      };
    })
    .sort((a, b) => b.value - a.value);
  const averageProfit = sold.length ? total / sold.length : 0;
  const averageDays = sold.length
    ? sold.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            Math.floor(
              (new Date(`${item.saleDate}T00:00:00`).getTime() -
                parseDateKey(item.purchaseDate).getTime()) /
                86400000,
            ),
          ),
        0,
      ) / sold.length
    : 0;
  const reportRows = view === 'year' ? yearly : monthly;
  return (
    <section className={`panel region-stats stats-${view}`}>
      {view === 'overview' && (
        <>
          <PeriodStats sold={sold} />
          <Title title="全部售出记录统计" note={`${sold.length} 条已售出记录 · 按售出日期统计`} />
          <div className="stat-grid">
            <Card title="销售额" value={money(revenue)} icon={<Wallet />} />
            <Card title="售出净收益" value={money(total)} icon={<TrendingUp />} />
            <Card
              title="平均每条售出净收益"
              value={money(Math.round(averageProfit))}
              icon={<TrendingUp />}
            />
            <Card title="平均售出天数" value={`${averageDays.toFixed(0)} 天`} icon={<Package />} />
          </div>
          <h3>平台售出净收益</h3>
          <div className="platform-summary">
            {platformGroups.map((group) => (
              <div className="category-income-row" key={group.platform}>
                <div className="grow">
                  <b>{group.platform}</b>
                  <small>{group.count} 条已售出记录</small>
                </div>
                <b className={group.value >= 0 ? 'gain' : 'loss'}>{money(group.value)}</b>
              </div>
            ))}
            {!platformGroups.length && <Empty text="暂无平台销售数据" />}
          </div>
          <ReportTable rows={monthly.slice(0, 12)} />
        </>
      )}
      {(view === 'month' || view === 'year') && (
        <>
          <Title
            title={view === 'month' ? '月度报表' : '年度报表'}
            note={`${reportRows.length} 个周期 · 按售出日期 · 金额单位：元`}
          />
          <ReportTable rows={reportRows} />
        </>
      )}
      {view === 'ranking' && (
        <div className="ranking-grid">
          <div>
            <h3>售出净收益排行</h3>
            {profitRanking.map((item, index) => (
              <div className="rank-row" key={item.id}>
                <b>{index + 1}</b>
                <span>{item.name}</span>
                <strong className={profitCents(item) >= 0 ? 'gain' : 'loss'}>
                  {money(profitCents(item))}
                </strong>
              </div>
            ))}
            {!profitRanking.length && <Empty text="暂无已售出商品" />}
          </div>
          <div>
            <h3>滞销库存排行</h3>
            {stagnant.map((item, index) => (
              <div className="rank-row" key={item.id}>
                <b>{index + 1}</b>
                <span>{item.name}</span>
                <strong>{inventoryDays(item)} 天</strong>
              </div>
            ))}
            {!stagnant.length && <Empty text="暂无库存商品" />}
          </div>
        </div>
      )}
    </section>
  );
}

function PeriodStats({ sold }: { sold: Item[] }) {
  const [period, setPeriod] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'year') start.setMonth(0);
  if (period === 'week') {
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  }
  const end = new Date(start);
  if (period === 'week') end.setDate(end.getDate() + 7);
  else if (period === 'year') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  const filtered = sold.filter((item) => {
    const date = item.saleDate ?? '';
    return period === 'custom'
      ? (!from || date >= from) && (!to || date <= to)
      : date >= dateKey(start) && date < dateKey(end);
  });
  const groups = [...new Set(filtered.map((item) => item.category))]
    .map((category) => ({
      category,
      value: filtered
        .filter((item) => item.category === category)
        .reduce((sum, item) => sum + profitCents(item), 0),
      count: filtered.filter((item) => item.category === category).length,
    }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="period-statistics">
      <div className="region-heading">
        <h2>区间经营表现</h2>
        <p>按售出日期统计，含待回款；确认回款收益请查看资金概览。</p>
      </div>
      <div className="period-tabs">
        {[
          ['week', '本周'],
          ['month', '本月'],
          ['year', '本年'],
          ['custom', '自定义'],
        ].map(([key, label]) => (
          <AsyncButton
            key={key}
            className={period === key ? 'selected' : ''}
            onClick={() => setPeriod(key)}
          >
            {label}
          </AsyncButton>
        ))}
      </div>
      {period === 'custom' && (
        <div className="two">
          <FormInput label="开始日期" type="date" value={from} onChange={setFrom} />
          <FormInput label="结束日期" type="date" value={to} onChange={setTo} />
        </div>
      )}
      <div className="stat-grid">
        <Card
          title="区间销售额"
          value={money(filtered.reduce((sum, item) => sum + (item.saleCents ?? 0), 0))}
          icon={<Wallet />}
        />
        <Card
          title="区间售出净收益"
          value={money(filtered.reduce((sum, item) => sum + profitCents(item), 0))}
          icon={<TrendingUp />}
        />
      </div>
      <h3>分类售出净收益</h3>
      {groups.map((group) => (
        <div
          className="category-income-row"
          key={group.category}
          style={{ '--category-color': categoryColor(group.category) } as React.CSSProperties}
        >
          <span className="category-income-icon">{group.category[0] ?? '?'}</span>
          <div className="grow">
            <b>{group.category}</b>
            <small>{group.count} 条已售出记录</small>
          </div>
          <span className="category-income-label">售出净收益</span>
          <b className={group.value < 0 ? 'loss' : 'gain'}>{money(group.value)}</b>
        </div>
      ))}
      {!groups.length && <Empty text="该时间段暂无销售数据" />}
    </div>
  );
}

function ReportTable({ rows }: { rows: ReturnType<typeof monthlySummary> }) {
  return (
    <>
      <p className="report-scroll-hint">左右滚动查看完整报表，也可聚焦表格后使用方向键。</p>
      <div
        className="report-table"
        role="region"
        aria-label="售出报表，可横向滚动查看"
        tabIndex={0}
      >
        <div className="report-head">
          <b>期间</b>
          <b>售出记录（条）</b>
          <b>销售额</b>
          <b>售出净收益</b>
          <b>销售净利率</b>
        </div>
        {rows.map((row) => (
          <div className="report-row" key={row.period}>
            <span>{row.period}</span>
            <span>{row.count}</span>
            <span>{money(row.revenueCents)}</span>
            <span className={row.profitCents >= 0 ? 'gain' : 'loss'}>{money(row.profitCents)}</span>
            <span>
              {row.revenueCents
                ? `${((row.profitCents / row.revenueCents) * 100).toFixed(1)}%`
                : '—'}
            </span>
          </div>
        ))}
        {!rows.length && <Empty text="暂无可统计的数据" />}
      </div>
    </>
  );
}
