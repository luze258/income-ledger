import type { AfterSale, FinanceState, Item } from './types';
import { dateKey, isDateKey, parseDateKey, profitCents } from './domain';

export const defaultFinance = (): FinanceState => ({ capitalLimitCents: 800000, afterSales: [] });
export const paymentStatus = (item: Pick<Item, 'paymentStatus'>) =>
  item.paymentStatus ?? 'historical';
export const expectedReceipt = (item: Item) =>
  Math.max(0, (item.saleCents ?? 0) - (item.platformFeeCents ?? 0));
export const principal = (item: Item) => item.purchaseCents * (item.quantity ?? 1);
export const outstandingPrincipal = (item: Item, state: FinanceState) =>
  Math.max(
    0,
    principal(item) -
      state.afterSales
        .filter((a) => a.itemId === item.id && a.recoveredDate)
        .reduce((sum, a) => sum + item.purchaseCents * a.quantity, 0),
  );
export const outstandingReceipt = (item: Item, state: FinanceState) =>
  Math.max(
    0,
    expectedReceipt(item) -
      state.afterSales
        .filter((a) => a.itemId === item.id && a.deductedFromReceipt)
        .reduce((s, a) => s + a.refundCents, 0),
  );
export const elapsedDays = (start: string, end = dateKey()) =>
  Math.max(0, Math.round((parseDateKey(end).getTime() - parseDateKey(start).getTime()) / 86400000));
export const turnoverDays = (item: Item) =>
  elapsedDays(
    item.purchaseDate,
    paymentStatus(item) === 'received' ? item.receivedDate : undefined,
  );
export const receivedProfit = (item: Item) =>
  (item.receivedCents ?? 0) -
  principal(item) -
  (item.shippingCents ?? 0) -
  (item.otherFeeCents ?? 0);

export function receiptReconciliation(item: Item, state: FinanceState) {
  const deductedRefund = state.afterSales
    .filter((a) => a.itemId === item.id && a.deductedFromReceipt)
    .reduce((sum, a) => sum + a.refundCents, 0);
  const expectedCents = Math.max(
    0,
    (item.settlementExpectedCents ?? expectedReceipt(item)) - deductedRefund,
  );
  const differenceCents = (item.receivedCents ?? 0) - expectedCents;
  const status =
    paymentStatus(item) !== 'received'
      ? 'not_received'
      : differenceCents === 0
        ? 'matched'
        : item.settlementReason?.trim()
          ? 'explained'
          : 'pending';
  return { expectedCents, differenceCents, status };
}

/** 历史回款未经确认，不作为新业务占用或超期；超过15天包含未售库存。 */
export function financeReminders(items: Item[], today = dateKey()) {
  const active = items.filter((i) => !i.deletedAt);
  const overdue = active.filter(
    (i) =>
      (i.status === 'in_stock' || paymentStatus(i) === 'pending') &&
      elapsedDays(i.purchaseDate, today) > 15,
  );
  const oldStock = active.filter(
    (i) => i.status === 'in_stock' && elapsedDays(i.purchaseDate, today) > 30,
  );
  return { overdue, oldStock };
}

export function validatePayment<T extends Omit<Item, 'imageData'>>(item: T): T {
  if (item.paymentStatus && !['pending', 'received', 'historical'].includes(item.paymentStatus))
    throw new Error('回款状态无效');
  if (
    item.receivedCents != null &&
    (!Number.isSafeInteger(item.receivedCents) || item.receivedCents < 0)
  )
    throw new Error('到账金额必须是非负整数分');
  if (
    item.settlementExpectedCents != null &&
    (!Number.isSafeInteger(item.settlementExpectedCents) || item.settlementExpectedCents < 0)
  )
    throw new Error('预计结算额必须是非负整数分');
  if (item.settlementReason != null && typeof item.settlementReason !== 'string')
    throw new Error('结算差额原因必须是文本');
  if (
    paymentStatus(item) !== 'received' &&
    (item.settlementExpectedCents != null || item.settlementReason != null)
  )
    throw new Error('未到账记录不能保留结算核对信息');
  if (
    item.status === 'in_stock' &&
    (item.paymentStatus || item.receivedDate || item.receivedCents != null)
  )
    throw new Error('库存商品不能记录回款');
  if (paymentStatus(item) === 'received') {
    if (
      item.receivedCents == null ||
      !item.receivedDate ||
      !isDateKey(item.receivedDate) ||
      item.receivedDate < (item.saleDate ?? item.purchaseDate)
    )
      throw new Error('到账需填写金额和不早于卖出日期的有效日期');
  } else if (item.receivedDate || item.receivedCents != null)
    throw new Error('未到账记录不能保留到账日期或金额');
  return item;
}

export function validateFinance(value: unknown): FinanceState {
  if (!value || typeof value !== 'object') throw new Error('资金配置格式无效');
  const state = value as FinanceState;
  for (const cents of [state.capitalLimitCents, state.cashCents ?? 0])
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('资金金额必须是非负整数分');
  if (
    (state.cashCents != null) !== Boolean(state.cashCheckedDate) ||
    (state.cashCheckedDate && !isDateKey(state.cashCheckedDate))
  )
    throw new Error('现金余额需要有效核对日期');
  if (!Array.isArray(state.afterSales)) throw new Error('售后记录格式无效');
  const ids = new Set<string>();
  for (const a of state.afterSales) {
    if (
      !a.id ||
      ids.has(a.id) ||
      !a.itemId ||
      !['return', 'partial_refund', 'write_off'].includes(a.kind) ||
      !isDateKey(a.date) ||
      !a.reason?.trim()
    )
      throw new Error('售后记录字段无效或重复');
    ids.add(a.id);
    for (const cents of [a.refundCents, a.lossCents, a.quantity])
      if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('售后金额与数量无效');
    if (a.kind === 'partial_refund' ? a.quantity !== 0 : a.quantity < 1)
      throw new Error('售后数量与类型不匹配');
    if (a.kind === 'write_off' && a.refundCents !== 0) throw new Error('报损不能有退款');
    if (
      a.recoveredDate &&
      (a.kind !== 'return' ||
        !a.returnedItemId ||
        !isDateKey(a.recoveredDate) ||
        a.recoveredDate < a.date)
    )
      throw new Error('收回商品信息无效');
  }
  return state;
}

export function validateFinanceReferences(state: FinanceState, items: Item[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const a of state.afterSales) {
    const item = byId.get(a.itemId);
    if (!item) throw new Error('售后记录的原商品不存在');
    if ((a.kind === 'write_off') !== (item.status === 'in_stock'))
      throw new Error('售后类型与原交易状态不匹配');
    if (a.date < (item.saleDate ?? item.purchaseDate)) throw new Error('售后日期早于原交易');
    if (a.recoveredDate && !byId.has(a.returnedItemId!))
      throw new Error('售后恢复的库存记录不存在');
    if (a.kind !== 'write_off') {
      const related = state.afterSales.filter((other) => other.itemId === item.id);
      if (related.reduce((s, r) => s + r.refundCents, 0) > (item.saleCents ?? 0))
        throw new Error('累计退款超出成交金额');
      if (
        related.filter((r) => r.kind === 'return').reduce((s, r) => s + r.quantity, 0) >
        (item.quantity ?? 1)
      )
        throw new Error('累计退回数量超出售出数量');
    }
  }
}

export function adjustmentProfit(a: AfterSale, item?: Item) {
  // 退回库存的采购成本转回资产，抵消原售出成本；报损金额由记录明确给出。
  return (
    -a.refundCents -
    a.lossCents +
    (a.kind === 'return' && a.recoveredDate ? (item?.purchaseCents ?? 0) * a.quantity : 0)
  );
}
export function financeSummary(items: Item[], state: FinanceState, month = dateKey().slice(0, 7)) {
  const active = items.filter((i) => !i.deletedAt);
  const sold = active.filter((i) => i.status === 'sold');
  const pending = sold.filter((i) => paymentStatus(i) === 'pending');
  const historical = sold.filter((i) => paymentStatus(i) === 'historical');
  const unreconciled = sold.filter((i) => receiptReconciliation(i, state).status === 'pending');
  const inventoryCost = active
    .filter((i) => i.status === 'in_stock')
    .reduce((s, i) => s + principal(i), 0);
  const sumPrincipal = (records: Item[]) =>
    records.reduce((sum, i) => sum + outstandingPrincipal(i, state), 0);
  const pendingPrincipal = sumPrincipal(pending);
  const historicalPrincipal = sumPrincipal(historical);
  const adjustments = state.afterSales.reduce((s, a) => {
    const item = items.find((i) => i.id === a.itemId);
    return (
      s +
      (a.date.startsWith(month) ? -a.refundCents - a.lossCents : 0) +
      (a.recoveredDate?.startsWith(month) ? (item?.purchaseCents ?? 0) * a.quantity : 0)
    );
  }, 0);
  const monthReceived = sold.filter(
    (i) => paymentStatus(i) === 'received' && i.receivedDate?.startsWith(month),
  );
  const baseReceivedProfit = (i: Item) =>
    receivedProfit(i) +
    state.afterSales
      .filter((a) => a.itemId === i.id && a.deductedFromReceipt)
      .reduce((sum, a) => sum + a.refundCents, 0);
  return {
    soldProfit: sold
      .filter((i) => i.saleDate?.startsWith(month))
      .reduce((s, i) => s + profitCents(i), 0),
    receivedProfit:
      monthReceived
        .filter((i) => receiptReconciliation(i, state).status !== 'pending')
        .reduce((sum, i) => sum + baseReceivedProfit(i), 0) + adjustments,
    unreconciledProfit: monthReceived
      .filter((i) => receiptReconciliation(i, state).status === 'pending')
      .reduce((sum, i) => sum + baseReceivedProfit(i), 0),
    pendingAmount: pending.reduce((s, i) => s + outstandingReceipt(i, state), 0),
    historicalAmount: historical.reduce((s, i) => s + outstandingReceipt(i, state), 0),
    historicalPrincipal,
    inventoryCost,
    pendingPrincipal,
    occupied: inventoryCost + pendingPrincipal,
    pending,
    historical,
    unreconciled,
  };
}

export function splitReceipt(
  item: Item,
  quantity: number,
  receivedCents: number,
  receivedDate: string,
  id: string,
  settlementReason?: string,
): Item[] {
  const total = item.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > total)
    throw new Error('到账数量超出本条售出数量');
  const updated = validatePayment({
    ...item,
    paymentStatus: 'received' as const,
    receivedDate,
    receivedCents,
    settlementExpectedCents: item.settlementExpectedCents ?? expectedReceipt(item),
    settlementReason: settlementReason?.trim() || undefined,
  });
  if (quantity === total) return [updated];
  if (paymentStatus(item) === 'received') throw new Error('已到账记录不能再次拆分');
  const paid = { ...updated, id, quantity, createdAt: Date.now() };
  const remainder = { ...item, quantity: total - quantity };
  for (const key of ['saleCents', 'shippingCents', 'platformFeeCents', 'otherFeeCents'] as const) {
    const value = item[key] ?? 0;
    paid[key] = Math.round((value * quantity) / total);
    remainder[key] = value - paid[key]!;
  }
  paid.settlementExpectedCents = expectedReceipt(paid);
  return [remainder, paid];
}
