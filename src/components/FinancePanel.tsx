import { Pagination } from './Pagination';
import { loadItemImage } from '../storage';
import { useEffect, useState } from 'react';
import type { AfterSale, FinanceState, Item } from '../types';
import { centsToYuan, dateKey, isDateKey, money, yuanToCents } from '../domain';
import {
  elapsedDays,
  outstandingReceipt,
  financeSummary,
  financeReminders,
  receiptReconciliation,
  paymentStatus,
  outstandingPrincipal,
  turnoverDays,
  splitReceipt,
} from '../finance';
import { AsyncButton } from '../actions';
import { Modal } from './Modal';
import { useFeedback } from '../feedback';

const Input = ({
  label,
  value,
  onChange,
  type = 'number',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) => (
  <label>
    {label}
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      step={type === 'number' ? '0.01' : undefined}
    />
  </label>
);
const labels = { return: '退款退回商品', partial_refund: '部分退款', write_off: '报损' };

export function FinancePanel({
  items,
  finance,
  onSave,
  initialAfterFilter = 'all',
  view = 'all',
  filter = 'pending',
  onFilter,
  pageSize = 10,
  receiptTarget,
  onReceiptHandled,
  onOpenReceipts,
  onOpenInventory,
}: {
  view?: 'all' | 'overview' | 'receipts' | 'afterSales';
  initialAfterFilter?: 'all' | 'waiting';
  filter?: 'pending' | 'received' | 'unreconciled' | 'historical';
  onFilter?: (value: 'pending' | 'received' | 'unreconciled' | 'historical') => void;
  pageSize?: number;
  receiptTarget?: Item | null;
  onReceiptHandled?: () => void;
  onOpenReceipts?: (value: 'pending' | 'received' | 'unreconciled' | 'historical') => void;
  onOpenInventory?: () => void;
  items: Item[];
  finance: FinanceState;
  onSave: (state: FinanceState, items?: Item[]) => Promise<void>;
}) {
  const { notify } = useFeedback();
  const summary = financeSummary(items, finance);
  const [receipt, setReceipt] = useState<Item | null>(null);
  const [afterItem, setAfterItem] = useState<Item | null>(null);
  const [settings, setSettings] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [afterFilter, setAfterFilter] = useState<string>(initialAfterFilter);
  useEffect(() => {
    setAfterFilter(initialAfterFilter);
  }, [initialAfterFilter]);
  const [afterSelection, setAfterSelection] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  useEffect(() => {
    setPage(1);
  }, [filter, view, query, afterFilter]);
  useEffect(() => {
    setQuery('');
  }, [view]);
  useEffect(() => {
    if (receiptTarget) setReceipt(receiptTarget);
  }, [receiptTarget]);
  const match = (item: Item) =>
    `${item.name} ${item.platform ?? ''}`
      .toLocaleLowerCase('zh-CN')
      .includes(query.trim().toLocaleLowerCase('zh-CN'));
  const activeItems = items.filter((item) => !item.deletedAt);
  const received = activeItems.filter(
    (item) => item.status === 'sold' && paymentStatus(item) === 'received',
  );
  const filteredReceipts = (
    filter === 'pending'
      ? summary.pending
      : filter === 'historical'
        ? summary.historical
        : filter === 'unreconciled'
          ? summary.unreconciled
          : received
  ).filter(match);
  const afterRows = finance.afterSales.filter((record) => {
    const item = items.find((item) => item.id === record.itemId);
    return (
      (!query.trim() ||
        `${item?.name ?? '原商品已移除'} ${record.reason}`
          .toLocaleLowerCase('zh-CN')
          .includes(query.trim().toLocaleLowerCase('zh-CN'))) &&
      (afterFilter === 'all' ||
        (afterFilter === 'waiting'
          ? record.kind === 'return' && !record.recoveredDate
          : record.kind === afterFilter))
    );
  });
  const total = view === 'afterSales' ? afterRows.length : filteredReceipts.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const slice = <T,>(rows: T[]) => rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const receiptRows = (rows: Item[]) => (view === 'all' ? rows : slice(rows.filter(match)));
  const closeReceipt = () => {
    setReceipt(null);
    onReceiptHandled?.();
  };
  const [limit, setLimit] = useState(centsToYuan(finance.capitalLimitCents));
  const [cash, setCash] = useState(finance.cashCents == null ? '' : centsToYuan(finance.cashCents));
  const [checked, setChecked] = useState(finance.cashCheckedDate ?? dateKey());
  const [recovery, setRecovery] = useState<AfterSale | null>(null);
  const [recoveryDate, setRecoveryDate] = useState(dateKey());

  const { overdue, oldStock } = financeReminders(items);
  async function saveSettings() {
    if (cash && !isDateKey(checked)) throw new Error('请选择有效核对日期');
    await onSave({
      ...finance,
      capitalLimitCents: yuanToCents(limit),
      cashCents: cash ? yuanToCents(cash) : undefined,
      cashCheckedDate: cash ? checked : undefined,
    });
    setSettings(false);
  }
  async function recover() {
    if (!recovery) return;
    if (!isDateKey(recoveryDate) || recoveryDate < recovery.date)
      throw new Error('收回日期不能早于售后日期');
    const item = items.find((i) => i.id === recovery.itemId);
    if (!item) throw new Error('原商品不存在');
    const returnedItemId = crypto.randomUUID();
    const returned: Item = {
      ...item,
      id: returnedItemId,
      quantity: recovery.quantity,
      status: 'in_stock',
      paymentStatus: undefined,
      saleCents: undefined,
      saleDate: undefined,
      shippingCents: undefined,
      platformFeeCents: undefined,
      otherFeeCents: undefined,
      receivedDate: undefined,
      receivedCents: undefined,
      settlementExpectedCents: undefined,
      settlementReason: undefined,
      deletedAt: undefined,
      note: `售后退回：${recovery.reason}`,
      imageData: await loadItemImage(item.id),
      createdAt: Date.now(),
    };
    await onSave(
      {
        ...finance,
        afterSales: finance.afterSales.map((a) =>
          a.id === recovery.id ? { ...a, recoveredDate: recoveryDate, returnedItemId } : a,
        ),
      },
      [returned],
    );
    setRecovery(null);
  }
  return (
    <>
      {(view === 'all' || view === 'overview') && (
        <section className="panel finance-panel finance-overview">
          <div className="panel-head">
            <div className="region-heading">
              <h2>回款与资金</h2>
              <p>当前营运本金与人工现金核对 · 历史回款独立保留</p>
            </div>
            <AsyncButton
              className="outline"
              onClick={() => {
                setLimit(centsToYuan(finance.capitalLimitCents));
                setCash(finance.cashCents == null ? '' : centsToYuan(finance.cashCents));
                setChecked(finance.cashCheckedDate ?? dateKey());
                setSettings(true);
              }}
            >
              核对现金 / 设置本金上限
            </AsyncButton>
          </div>
          <div className="cards finance-cards">
            {[
              ['营运占用本金（不含历史待确认）', summary.occupied],
              ['剩余本金限额', finance.capitalLimitCents - summary.occupied],
              ['库存成本', summary.inventoryCost],
              ['已售未回款本金', summary.pendingPrincipal],
            ].map(([name, value]) => (
              <div className="card" key={name}>
                <div>
                  <small>{name}</small>
                  <b>{money(Number(value))}</b>
                </div>
              </div>
            ))}
          </div>
          <details className="calculation-notes">
            <summary>收益与历史待确认明细</summary>
            {[
              ['本月售出净收益（含待回款）', summary.soldProfit],
              ['本月已确认回款净收益', summary.receivedProfit],
              ['本月待核对交易收益（未计入目标）', summary.unreconciledProfit],
              ['新业务待回款金额', summary.pendingAmount],
              ['历史待确认金额', summary.historicalAmount],
              ['历史待确认本金', summary.historicalPrincipal],
            ].map(([label, value]) => (
              <div className="row" key={label}>
                <span className="grow">{label}</span>
                <b>{money(Number(value))}</b>
              </div>
            ))}
          </details>
          <details className="calculation-notes">
            <summary>查看计算口径与历史数据说明</summary>
            <p>
              售出收益按卖出日期；已回款收益按到账日期，计入当月售后调整。平台代扣费用已包含在到账额中，不再扣减。
            </p>
            <p>
              历史待确认金额与本金单列，不代表当前应收款，不扣减营运额度。核实仍未到账后可改为待回款；核实已到账后填写真实日期与金额。
              有结算差额且原因未填写的交易暂不计入已确认回款收益和月目标，售后调整仍按发生月份计入。
            </p>
          </details>
          <p>
            人工核对现金余额：
            {finance.cashCents == null
              ? '尚未核对'
              : `${money(finance.cashCents)} · 核对日期 ${finance.cashCheckedDate}`}{' '}
            · 营运本金上限 {money(finance.capitalLimitCents)}
          </p>
          <p role="status">
            {overdue.length
              ? `付款超过15天仍占用本金：${overdue.length}条（未售库存及待回款）。`
              : ''}
            {oldStock.length ? `库存超过30天：${oldStock.length}条。` : ''}
            {summary.occupied > finance.capitalLimitCents ? '总占用本金超过上限。' : ''}
            {summary.unreconciled.length
              ? `结算差额待核对：${summary.unreconciled.length}条。`
              : ''}
            {!overdue.length &&
            !oldStock.length &&
            !summary.unreconciled.length &&
            summary.occupied <= finance.capitalLimitCents
              ? '当前没有资金周转提醒。'
              : ''}{' '}
            提醒不会阻止记录交易。
          </p>
          <div className="page-actions">
            {onOpenReceipts && (
              <AsyncButton className="outline" onClick={() => onOpenReceipts('pending')}>
                管理待回款
              </AsyncButton>
            )}
            {onOpenInventory && (
              <AsyncButton className="outline" onClick={onOpenInventory}>
                查看超过15天的占用记录
              </AsyncButton>
            )}
            {onOpenReceipts && summary.unreconciled.length > 0 && (
              <AsyncButton className="outline" onClick={() => onOpenReceipts('unreconciled')}>
                核对结算差额
              </AsyncButton>
            )}
          </div>
        </section>
      )}
      {(view === 'all' || view === 'receipts') && (
        <section className="panel finance-panel finance-receipts">
          <div className="region-heading">
            <h2>回款记录</h2>
            <p>先选择状态与商品，再核对真实到账日期、数量及金额。</p>
          </div>
          {view === 'receipts' && (
            <>
              <div className="period-tabs" aria-label="回款状态">
                {(
                  [
                    ['pending', `待回款 (${summary.pending.length})`],
                    ['received', `已回款 (${received.length})`],
                    ['unreconciled', `差额待核对 (${summary.unreconciled.length})`],
                    ['historical', `历史回款待确认 (${summary.historical.length})`],
                  ] as const
                ).map(([key, label]) => (
                  <AsyncButton
                    key={key}
                    className={filter === key ? 'selected' : ''}
                    onClick={() => onFilter?.(key)}
                  >
                    {label}
                  </AsyncButton>
                ))}
              </div>
              <input
                className="page-search"
                aria-label="搜索回款记录"
                placeholder="搜索商品名称或平台"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </>
          )}
          {(view === 'all' || filter === 'pending') && (
            <>
              <h2>新业务待回款 · {summary.pending.length} 条</h2>
              <p>
                历史交易请核对流水后确认，到账日期不会自动补填。每条售出可分别到账；同一笔只有部分到账时，填写本次到账数量，系统拆分记录。
              </p>
              {receiptRows(summary.pending).map((i) => (
                <div className="row" key={i.id}>
                  <div className="grow">
                    <b>
                      {i.name} · {i.quantity ?? 1}件
                    </b>
                    <small>
                      {paymentStatus(i) === 'historical' ? '历史回款待确认' : '待回款'} · 卖出{' '}
                      {i.saleDate} · 等待 {elapsedDays(i.saleDate ?? i.purchaseDate)}天 · 本金已占用{' '}
                      {turnoverDays(i)}天
                    </small>
                  </div>
                  <span>预计到账 {money(outstandingReceipt(i, finance))}</span>
                  <span>本金 {money(outstandingPrincipal(i, finance))}</span>
                  <AsyncButton className="outline" onClick={() => setReceipt(i)}>
                    标记到账
                  </AsyncButton>
                  <AsyncButton className="outline" onClick={() => setAfterItem(i)}>
                    售后
                  </AsyncButton>
                </div>
              ))}
              {!summary.pending.length && <p>暂无待回款交易。</p>}
            </>
          )}
          {(view === 'all' || filter === 'historical') && (
            <>
              <h3>历史回款待确认 · {summary.historical.length} 条</h3>
              <p>
                以下记录未计入新业务待回款、营运占用及15天提醒；等待天数未知，请先核实真实回款情况。
              </p>
              {receiptRows(summary.historical).map((i) => (
                <div className="row" key={i.id}>
                  <div className="grow">
                    <b>
                      {i.name} · {i.quantity ?? 1}件
                    </b>
                    <small>
                      卖出 {i.saleDate} · 历史待确认金额 {money(outstandingReceipt(i, finance))} ·
                      本金 {money(outstandingPrincipal(i, finance))}
                    </small>
                  </div>
                  <AsyncButton className="outline" onClick={() => setReceipt(i)}>
                    核对历史回款
                  </AsyncButton>
                </div>
              ))}
            </>
          )}
          {(view === 'all' || filter === 'unreconciled') && (
            <>
              <h3>结算差额待核对 · {summary.unreconciled.length} 条</h3>
              {receiptRows(summary.unreconciled).map((i) => (
                <div className="row" key={i.id}>
                  <div className="grow">
                    <b>
                      {i.name} · 已到账 {i.receivedDate}
                    </b>
                    <SettlementDetails item={i} finance={finance} />
                  </div>
                  <AsyncButton className="outline" onClick={() => setReceipt(i)}>
                    核对结算差额
                  </AsyncButton>
                </div>
              ))}
            </>
          )}
          {view === 'receipts' && filter === 'received' && (
            <>
              <h2>已回款记录 · {received.length} 条</h2>
              {receiptRows(received).map((item) => (
                <div className="row" key={item.id}>
                  <div className="grow">
                    <b>{item.name}</b>
                    <small>
                      {item.receivedDate} · 已到账 {money(item.receivedCents ?? 0)} · 周转{' '}
                      {turnoverDays(item)}天
                    </small>
                    <SettlementDetails item={item} finance={finance} />
                  </div>
                  <AsyncButton className="outline" onClick={() => setReceipt(item)}>
                    核对回款
                  </AsyncButton>
                  <AsyncButton className="outline" onClick={() => setAfterItem(item)}>
                    售后
                  </AsyncButton>
                </div>
              ))}
            </>
          )}
          {view === 'receipts' && (
            <>
              {!total && <p>没有匹配的回款记录。</p>}
              <Pagination page={safePage} total={total} pageSize={pageSize} onPage={setPage} />
            </>
          )}
        </section>
      )}
      {view === 'afterSales' && (
        <section className="panel finance-panel finance-after-sales">
          <div className="region-heading">
            <h2>售后记录</h2>
            <p>选择原商品登记退款、退货或报损；退货收回沿用原库存恢复流程。</p>
          </div>
          <input
            className="page-search"
            aria-label="搜索可登记售后的商品"
            placeholder="先搜索商品名称，再选择对应交易"
            value={itemSearch}
            onChange={(event) => {
              setItemSearch(event.target.value);
              setAfterSelection('');
            }}
          />
          <div className="inline-form">
            <label>
              登记售后或报损
              <select
                aria-label="选择售后商品"
                value={afterSelection}
                onChange={(event) => setAfterSelection(event.target.value)}
              >
                <option value="">选择商品</option>
                {activeItems
                  .filter((item) =>
                    item.name
                      .toLocaleLowerCase('zh-CN')
                      .includes(itemSearch.trim().toLocaleLowerCase('zh-CN')),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.status === 'sold' ? `已售 ${item.saleDate}` : '库存中'} ·{' '}
                      {item.quantity ?? 1}件 · {item.id.slice(-6)}
                    </option>
                  ))}
              </select>
            </label>
            <AsyncButton
              className="outline"
              disabled={!afterSelection}
              onClick={() => setAfterItem(activeItems.find((item) => item.id === afterSelection)!)}
            >
              登记售后 / 报损
            </AsyncButton>
          </div>
          <div className="page-actions">
            <input
              className="page-search"
              aria-label="搜索售后记录"
              placeholder="搜索商品或售后原因"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="售后类型"
              value={afterFilter}
              onChange={(event) => setAfterFilter(event.target.value)}
            >
              <option value="all">全部售后</option>
              <option value="waiting">退货待收回</option>
              <option value="return">退款退回商品</option>
              <option value="partial_refund">部分退款</option>
              <option value="write_off">报损</option>
            </select>
          </div>
          {slice(afterRows).map((a) => (
            <div className="row" key={a.id}>
              <div className="grow">
                <b>
                  {items.find((i) => i.id === a.itemId)?.name ?? '原商品已移除'} · {labels[a.kind]}
                </b>
                <small>
                  {a.date} · {a.reason} · 退款 {money(a.refundCents)} · 损失 {money(a.lossCents)} ·
                  数量 {a.quantity}
                  {a.kind === 'return'
                    ? a.recoveredDate
                      ? ` · 已收回 ${a.recoveredDate}`
                      : ' · 待收回'
                    : ''}
                </small>
              </div>
              {a.kind === 'return' && !a.recoveredDate && (
                <AsyncButton
                  className="outline"
                  onClick={() => {
                    setRecovery(a);
                    setRecoveryDate(dateKey());
                  }}
                >
                  确认收回
                </AsyncButton>
              )}
            </div>
          ))}
          {!total && <p>没有匹配的售后记录。</p>}
          <Pagination page={safePage} total={total} pageSize={pageSize} onPage={setPage} />
        </section>
      )}
      {settings && (
        <Modal title="资金核对" onClose={() => setSettings(false)}>
          <Input label="营运本金上限（元）" value={limit} onChange={setLimit} />
          <Input label="可用现金（元，留空清除）" value={cash} onChange={setCash} />
          <Input label="核对日期" type="date" value={checked} onChange={setChecked} />
          <AsyncButton className="primary" onClick={saveSettings}>
            保存
          </AsyncButton>
        </Modal>
      )}
      {receipt && (
        <ReceiptModal
          item={receipt}
          expected={receiptReconciliation(receipt, finance).expectedCents}
          onClose={closeReceipt}
          onSave={async (updates) => {
            if (updates.length > 1 && finance.afterSales.some((a) => a.itemId === receipt.id))
              throw new Error('该交易已有售后记录，请先按整条交易核对回款');
            await onSave(finance, updates);
            closeReceipt();
            notify('回款记录已保存');
          }}
        />
      )}
      {afterItem && (
        <AfterSaleModal
          item={afterItem}
          records={finance.afterSales}
          onClose={() => setAfterItem(null)}
          onSave={async (a, updates) => {
            await onSave({ ...finance, afterSales: [a, ...finance.afterSales] }, updates);
            setAfterItem(null);
          }}
        />
      )}
      {recovery && (
        <Modal title="确认退回商品收回" onClose={() => setRecovery(null)}>
          <p>收回 {recovery.quantity} 件后恢复库存，原交易保留。</p>
          <Input label="实际收回日期" type="date" value={recoveryDate} onChange={setRecoveryDate} />
          <AsyncButton className="primary" onClick={recover}>
            确认收回并恢复库存
          </AsyncButton>
        </Modal>
      )}
    </>
  );
}

function SettlementDetails({ item, finance }: { item: Item; finance: FinanceState }) {
  const reconciliation = receiptReconciliation(item, finance);
  return (
    <small>
      预计结算 {money(reconciliation.expectedCents)} · 实际到账 {money(item.receivedCents ?? 0)} ·
      差额（实际－预计）{money(reconciliation.differenceCents)} ·
      {reconciliation.status === 'pending'
        ? '待核对'
        : reconciliation.status === 'matched'
          ? '金额一致'
          : '差额已说明'}
      {item.settlementReason ? ` · 原因：${item.settlementReason}` : ''}
    </small>
  );
}

function ReceiptModal({
  item,
  expected,
  onClose,
  onSave,
}: {
  item: Item;
  expected: number;
  onClose: () => void;
  onSave: (items: Item[]) => Promise<void>;
}) {
  const [status, setStatus] = useState<'pending' | 'received' | 'historical'>('received');
  const [date, setDate] = useState(item.receivedDate ?? dateKey());
  const [amount, setAmount] = useState(centsToYuan(item.receivedCents ?? expected));
  const [quantity, setQuantity] = useState(String(item.quantity ?? 1));
  const [reason, setReason] = useState(item.settlementReason ?? '');
  const total = item.quantity ?? 1;
  const expectedForQuantity = (q: number) =>
    q === total
      ? expected
      : Math.max(
          0,
          Math.round(((item.saleCents ?? 0) * q) / total) -
            Math.round(((item.platformFeeCents ?? 0) * q) / total),
        );
  const selectedExpected = expectedForQuantity(Number(quantity));
  let difference: number | undefined;
  try {
    difference = yuanToCents(amount) - selectedExpected;
  } catch {
    /* 提交时校验。 */
  }
  async function submit() {
    const q = Number(quantity),
      total = item.quantity ?? 1;
    if (!Number.isSafeInteger(q) || q < 1 || q > total) throw new Error('到账数量超出本条售出数量');
    if (status !== 'received') {
      await onSave([
        {
          ...item,
          paymentStatus: status,
          receivedDate: undefined,
          receivedCents: undefined,
          settlementExpectedCents: undefined,
          settlementReason: undefined,
        },
      ]);
      return;
    }
    await onSave(
      splitReceipt(
        { ...item, imageData: await loadItemImage(item.id) },
        q,
        yuanToCents(amount),
        date,
        crypto.randomUUID(),
        reason,
      ),
    );
  }
  return (
    <Modal title={`回款 · ${item.name}`} onClose={onClose}>
      <label>
        回款状态
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="pending">待回款</option>
          <option value="received">已到账</option>
          {paymentStatus(item) === 'historical' && (
            <option value="historical">历史回款待确认</option>
          )}
        </select>
      </label>
      {status === 'received' && (
        <>
          <Input
            label="本次到账商品数量"
            value={quantity}
            onChange={(q) => {
              setQuantity(q);
              setAmount(centsToYuan(expectedForQuantity(Number(q))));
            }}
          />
          <Input label="实际到账日期" type="date" value={date} onChange={setDate} />
          <Input label="实际到账金额（元）" value={amount} onChange={setAmount} />
          <p>
            预计结算 {Number.isFinite(selectedExpected) ? money(selectedExpected) : '数量无效'} ·
            差额（实际－预计）
            {difference == null || !Number.isFinite(difference)
              ? '待填写有效金额'
              : money(difference)}{' '}
            ·{difference === 0 ? '金额一致' : reason.trim() ? '差额已说明' : '待核对'}
          </p>
          <Input
            label="结算差额原因（留空表示待核对）"
            type="text"
            value={reason}
            onChange={setReason}
          />
          <p>
            差额原因可填写平台调整或新增费用等核对结果；留空可保存真实到账，但该笔收益暂不计入已确认回款收益。
          </p>
          <p>
            到账金额为平台结算额，已扣平台费用。邮费与其他费用在收益中另扣。按真实流水填写；退款若已包含在到账额中，请在售后记录勾选“退款已从实际到账额中扣除”。
          </p>
        </>
      )}
      <AsyncButton className="primary" onClick={submit}>
        保存回款
      </AsyncButton>
    </Modal>
  );
}

function AfterSaleModal({
  item,
  records,
  onClose,
  onSave,
}: {
  item: Item;
  records: AfterSale[];
  onClose: () => void;
  onSave: (record: AfterSale, items?: Item[]) => Promise<void>;
}) {
  const [kind, setKind] = useState<AfterSale['kind']>(
    item.status === 'sold' ? 'partial_refund' : 'write_off',
  );
  const [date, setDate] = useState(dateKey());
  const [refund, setRefund] = useState('0');
  const [deducted, setDeducted] = useState(false);
  const [loss, setLoss] = useState('0');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  async function submit() {
    if (!isDateKey(date) || date < (item.saleDate ?? item.purchaseDate))
      throw new Error('售后日期不能早于原交易日期');
    if (!reason.trim()) throw new Error('请填写原因');
    const q = kind === 'partial_refund' ? 0 : Number(quantity);
    const already = records
      .filter((a) => a.itemId === item.id && a.kind === 'return')
      .reduce((s, a) => s + a.quantity, 0);
    if (
      !Number.isSafeInteger(q) ||
      q < 0 ||
      (kind !== 'partial_refund' &&
        (q < 1 || q > (item.quantity ?? 1) - (kind === 'return' ? already : 0)))
    )
      throw new Error('数量超出可退回或报损数量');
    const refundCents = kind === 'write_off' ? 0 : yuanToCents(refund);
    if (
      kind !== 'write_off' &&
      refundCents +
        records.filter((a) => a.itemId === item.id).reduce((s, a) => s + a.refundCents, 0) >
        (item.saleCents ?? 0)
    )
      throw new Error('累计退款不能超过成交金额');
    const a: AfterSale = {
      id: crypto.randomUUID(),
      itemId: item.id,
      kind,
      date,
      refundCents,
      quantity: q,
      lossCents: yuanToCents(loss),
      reason: reason.trim(),
      deductedFromReceipt: deducted,
    };
    let updates: Item[] = [];
    if (kind === 'write_off') {
      // 报损损失包含采购成本，界面额外损失仅输入运费等实际支出。
      a.lossCents += item.purchaseCents * q;
      const remaining = (item.quantity ?? 1) - q;
      updates = [remaining ? { ...item, quantity: remaining } : { ...item, deletedAt: Date.now() }];
    }
    await onSave(a, updates);
  }
  return (
    <Modal title={`售后 · ${item.name}`} onClose={onClose}>
      <label>
        类型
        <select value={kind} onChange={(e) => setKind(e.target.value as AfterSale['kind'])}>
          {item.status === 'sold' ? (
            <>
              <option value="partial_refund">部分退款，商品未退回</option>
              <option value="return">退款退回商品</option>
            </>
          ) : (
            <option value="write_off">报损</option>
          )}
        </select>
      </label>
      <Input label="发生日期" type="date" value={date} onChange={setDate} />
      {kind !== 'write_off' && <Input label="退款金额（元）" value={refund} onChange={setRefund} />}
      {kind !== 'write_off' && (
        <label>
          <input
            type="checkbox"
            checked={deducted}
            onChange={(e) => setDeducted(e.target.checked)}
          />
          退款已从实际到账额中扣除（避免重复计损）
        </label>
      )}{' '}
      {kind !== 'partial_refund' && <Input label="数量" value={quantity} onChange={setQuantity} />}
      <Input label="运费及其他额外损失（元）" value={loss} onChange={setLoss} />
      <Input label="原因" type="text" value={reason} onChange={setReason} />
      <p>
        {kind === 'write_off'
          ? `采购成本自动计入损失，当前单件成本 ${money(item.purchaseCents)}。`
          : '原售出记录保留。退款退回商品需在实际收回后确认恢复库存。'}{' '}
        已记录的费用请勿重复填写。
      </p>
      <AsyncButton className="primary" onClick={submit}>
        保存售后记录
      </AsyncButton>
    </Modal>
  );
}
