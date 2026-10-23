import { useEffect, useMemo, useState } from 'react';

import { Boxes, Package, TrendingUp, Wallet } from 'lucide-react';
import {
  calculateSaleFromForm,
  centsToYuan,
  dateKey,
  inventoryDays,
  isDateKey,
  money,
  yuanToCents,
} from '../domain';

import type { InventoryMovement, Item } from '../types';
import { AsyncButton, useAction } from '../actions';
import { Modal } from '../components/Modal';
import { Thumb } from '../components/Thumb';

import { Pagination } from '../components/Pagination';
import { useFeedback } from '../feedback';
import { type LedgerPreferences } from '../preferences';

import { Card, Title, Empty, FormInput } from '../components/Shared';
import { SalePaymentFields, validatedSalePayment } from '../components/SalePaymentFields';

export function InventoryPage({
  historyOnly,
  items,
  preferences,
  pageSize,
  movements,
  onDetails,
  onInventoryChange,
  onOpenProducts,
}: {
  historyOnly: boolean;
  items: Item[];
  preferences: LedgerPreferences;
  pageSize: number;
  movements: InventoryMovement[];
  onDetails: (item: Item) => void;
  onInventoryChange: (item: Item, movement: InventoryMovement, soldItem?: Item) => Promise<void>;
  onOpenProducts: () => void;
}) {
  const inventory = items.filter((item) => item.status === 'in_stock');
  const totalQuantity = inventory.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  const totalCost = inventory.reduce(
    (sum, item) => sum + item.purchaseCents * (item.quantity ?? 1),
    0,
  );
  const lowStock = inventory.filter((item) => (item.quantity ?? 1) <= 1);
  const stagnant = inventory
    .filter((item) => inventoryDays(item) >= preferences.stagnantDays)
    .sort((left, right) => inventoryDays(right) - inventoryDays(left));

  if (historyOnly)
    return <InventoryHistory movements={movements} items={items} pageSize={pageSize} />;
  return (
    <div className="region-inventory">
      <div className="cards inventory-cards">
        <Card title="库存商品" value={`${inventory.length} 条`} icon={<Package />} />
        <Card title="可售数量" value={`${totalQuantity} 件`} icon={<Boxes />} />
        <Card title="库存成本" value={money(totalCost)} icon={<Wallet />} />
        <Card title="低库存（≤1件）" value={`${lowStock.length} 条`} icon={<TrendingUp />} />
      </div>
      <section className="panel inventory-overview">
        <Title title="库存概览" note="按单价 × 当前数量计算 · 库存成本不是亏损" />
        <div className="inventory-overview-summary">
          <div>
            <b>{stagnant.length}</b>
            <span>条库存已超过 {preferences.stagnantDays} 天</span>
          </div>
          <AsyncButton className="outline" onClick={onOpenProducts}>
            管理库存商品
          </AsyncButton>
        </div>
        {stagnant.slice(0, 5).map((item) => (
          <div className="row" key={item.id}>
            <Thumb item={item} />
            <div className="grow">
              <b>{item.name}</b>
              <small>
                {item.category} · {item.quantity ?? 1} 件 · 已库存 {inventoryDays(item)} 天
              </small>
            </div>
            <span className="inventory-cost">
              库存成本 {money(item.purchaseCents * (item.quantity ?? 1))}
            </span>
          </div>
        ))}
        {!inventory.length && <Empty text="当前没有库存商品，添加商品后会自动在这里汇总。" />}
        {inventory.length > 0 && !stagnant.length && (
          <Empty text={`目前没有库存超过 ${preferences.stagnantDays} 天。`} />
        )}
      </section>
      <InventoryList
        items={inventory}
        pageSize={pageSize}
        onInventoryChange={onInventoryChange}
        onDetails={onDetails}
      />
    </div>
  );
}

function InventoryHistory({
  movements,
  items,
  pageSize,
}: {
  movements: InventoryMovement[];
  items: Item[];
  pageSize: number;
}) {
  const [page, setPage] = useState(1);
  const effectivePageSize = [10, 20, 50].includes(pageSize) ? pageSize : 10;
  const safePage = Math.min(page, Math.max(1, Math.ceil(movements.length / effectivePageSize)));
  const itemNames = new Map(items.map((item) => [item.id, item.name]));
  const labels: Record<InventoryMovement['kind'], string> = {
    stock_in: '补货入库',
    adjustment: '盘点调整',
    partial_sale: '部分售出',
  };
  return (
    <section className="panel inventory-history region-inventory-history">
      <Title title="库存变动记录" note={`共 ${movements.length} 条`} />
      {movements
        .slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize)
        .map((movement) => (
          <div className="row" key={movement.id}>
            <div className="inventory-movement-dot">{movement.quantityDelta > 0 ? '+' : '−'}</div>
            <div className="grow">
              <b>{itemNames.get(movement.itemId) ?? '已删除商品'}</b>
              <small>
                {labels[movement.kind]} · {new Date(movement.createdAt).toLocaleString('zh-CN')}
                {movement.note ? ` · ${movement.note}` : ''}
              </small>
            </div>
            <div className="inventory-quantity-change">
              {movement.quantityDelta > 0 ? '+' : ''}
              {movement.quantityDelta} 件
              <small>
                {movement.quantityBefore} → {movement.quantityAfter}
              </small>
            </div>
          </div>
        ))}
      {!movements.length && <Empty text="还没有库存变动记录。" />}
      <Pagination
        page={safePage}
        total={movements.length}
        pageSize={effectivePageSize}
        onPage={setPage}
      />
    </section>
  );
}

function InventoryList({
  items,
  pageSize,
  onInventoryChange,
  onDetails,
}: {
  items: Item[];
  pageSize: number;
  onInventoryChange: (item: Item, movement: InventoryMovement, soldItem?: Item) => Promise<void>;
  onDetails: (item: Item) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部分类');
  const [sort, setSort] = useState<
    'newest' | 'quantityAsc' | 'quantityDesc' | 'costDesc' | 'daysDesc'
  >('newest');
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<Item | null>(null);
  const [selling, setSelling] = useState<Item | null>(null);
  const categories = [...new Set(items.map((item) => item.category))].sort((left, right) =>
    left.localeCompare(right, 'zh-CN'),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const list = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (category === '全部分类' || item.category === category) &&
            `${item.name} ${item.note ?? ''} ${item.tags.join(' ')}`
              .toLocaleLowerCase('zh-CN')
              .includes(normalizedQuery),
        )
        .sort((left, right) => {
          if (sort === 'quantityAsc') return (left.quantity ?? 1) - (right.quantity ?? 1);
          if (sort === 'quantityDesc') return (right.quantity ?? 1) - (left.quantity ?? 1);
          if (sort === 'costDesc')
            return (
              right.purchaseCents * (right.quantity ?? 1) -
              left.purchaseCents * (left.quantity ?? 1)
            );
          if (sort === 'daysDesc') return inventoryDays(right) - inventoryDays(left);
          return right.createdAt - left.createdAt;
        }),
    [items, category, normalizedQuery, sort],
  );
  const effectivePageSize = [10, 20, 50].includes(pageSize) ? pageSize : 10;
  const totalPages = Math.max(1, Math.ceil(list.length / effectivePageSize));
  const safePage = Math.min(page, totalPages);
  const rows = list.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);

  useEffect(() => setPage(1), [query, category, sort]);

  return (
    <section className="panel inventory-list region-inventory-list">
      <Title title="库存明细" note={`${list.length} 条库存商品`} />
      <div className="filter-toolbar inventory-filter-toolbar">
        <input
          aria-label="搜索库存"
          placeholder="搜索名称、备注或标签"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option>全部分类</option>
          {categories.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
          <option value="newest">最新入库</option>
          <option value="quantityAsc">数量从少到多</option>
          <option value="quantityDesc">数量从多到少</option>
          <option value="costDesc">库存成本从高到低</option>
          <option value="daysDesc">库存天数从高到低</option>
        </select>
      </div>
      {rows.map((item) => (
        <div className="row" key={item.id}>
          <Thumb item={item} />
          <div className="grow">
            <b>{item.name}</b>
            <small>
              {item.category} · 单价 {money(item.purchaseCents)} · 库存 {inventoryDays(item)} 天
            </small>
          </div>
          <div className="inventory-row-amount">
            <b>{item.quantity ?? 1} 件</b>
            <small>成本 {money(item.purchaseCents * (item.quantity ?? 1))}</small>
          </div>
          <AsyncButton className="outline" onClick={() => onDetails(item)}>
            详情
          </AsyncButton>
          <AsyncButton className="outline" onClick={() => setAdjusting(item)}>
            调整库存
          </AsyncButton>
          <AsyncButton
            className="outline"
            disabled={(item.quantity ?? 1) < 2}
            title={(item.quantity ?? 1) < 2 ? '库存至少为 2 件时可使用部分售出' : undefined}
            onClick={() => setSelling(item)}
          >
            部分售出
          </AsyncButton>
        </div>
      ))}
      {!list.length && <Empty text="没有符合条件的库存商品。" />}
      <Pagination
        page={safePage}
        total={list.length}
        pageSize={effectivePageSize}
        onPage={setPage}
      />
      {adjusting && (
        <InventoryAdjustmentModal
          item={adjusting}
          onClose={() => setAdjusting(null)}
          onSave={async (item, movement) => {
            await onInventoryChange(item, movement);
            setAdjusting(null);
          }}
        />
      )}
      {selling && (
        <PartialSaleModal
          item={selling}
          onClose={() => setSelling(null)}
          onSave={async (item, movement, soldItem) => {
            await onInventoryChange(item, movement, soldItem);
            setSelling(null);
          }}
        />
      )}
    </section>
  );
}

function PartialSaleModal({
  item,
  onClose,
  onSave,
}: {
  item: Item;
  onClose: () => void;
  onSave: (item: Item, movement: InventoryMovement, soldItem: Item) => Promise<void>;
}) {
  const [payment, setPayment] = useState<Partial<Item>>({ paymentStatus: 'pending' });
  const { run } = useAction();
  const { notify } = useFeedback();
  const available = item.quantity ?? 1;
  const [form, setForm] = useState({
    quantity: '1',
    unitSale: item.expectedSaleCents == null ? '' : centsToYuan(item.expectedSaleCents),
    saleDate: dateKey(),
    platform: item.platform ?? '',
    shipping: '0',
    shippingMode: 'per_order' as 'per_order' | 'per_unit',
    platformFee: '0',
    platformFeeMode: 'fixed' as 'fixed' | 'percent',
    otherFee: '0',
    otherFeeMode: 'per_order' as 'per_order' | 'per_unit',
    note: '',
  });
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const quantity = Number(form.quantity);
  let calculation = {
    saleCents: 0,
    shippingCents: 0,
    platformFeeCents: 0,
    otherFeeCents: 0,
    profitCents: 0,
  };
  try {
    calculation = calculateSaleFromForm({
      quantity,
      unitPurchaseCents: item.purchaseCents,
      unitSale: form.unitSale,
      shipping: form.shipping,
      shippingMode: form.shippingMode,
      platformFee: form.platformFee,
      platformFeeMode: form.platformFeeMode,
      otherFee: form.otherFee,
      otherFeeMode: form.otherFeeMode,
    });
  } catch {
    // 保存时给出明确提示。
  }
  const estimate = calculation.profitCents;
  async function submit() {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity >= available) {
      notify(`部分售出数量须为 1 至 ${available - 1} 件`);
      return;
    }
    if (!isDateKey(form.saleDate) || form.saleDate < item.purchaseDate) {
      notify('请选择不早于购入日期的有效卖出日期');
      return;
    }
    try {
      const submittedCalculation = calculateSaleFromForm({
        quantity,
        unitPurchaseCents: item.purchaseCents,
        unitSale: form.unitSale,
        shipping: form.shipping,
        shippingMode: form.shippingMode,
        platformFee: form.platformFee,
        platformFeeMode: form.platformFeeMode,
        otherFee: form.otherFee,
        otherFeeMode: form.otherFeeMode,
      });
      const soldItem: Item = {
        ...item,
        id: crypto.randomUUID(),
        quantity,
        status: 'sold',
        saleCents: submittedCalculation.saleCents,
        shippingCents: submittedCalculation.shippingCents,
        platformFeeCents: submittedCalculation.platformFeeCents,
        otherFeeCents: submittedCalculation.otherFeeCents,
        ...validatedSalePayment(payment, item, form.saleDate, submittedCalculation),
        saleDate: form.saleDate,
        platform: form.platform.trim() || undefined,
        note: form.note.trim() || item.note,
        createdAt: Date.now(),
      };
      const movement: InventoryMovement = {
        id: crypto.randomUUID(),
        itemId: item.id,
        kind: 'partial_sale',
        quantityDelta: -quantity,
        quantityBefore: available,
        quantityAfter: available - quantity,
        unitCents: item.purchaseCents,
        shippingCents: yuanToCents(form.shipping),
        shippingMode: form.shippingMode,
        platformFeeValue:
          form.platformFeeMode === 'percent'
            ? Math.round(Number(form.platformFee) * 100)
            : yuanToCents(form.platformFee),
        platformFeeMode: form.platformFeeMode,
        otherFeeCents: yuanToCents(form.otherFee),
        otherFeeMode: form.otherFeeMode,
        note: form.note.trim() || undefined,
        createdAt: soldItem.createdAt,
      };
      await onSave({ ...item, quantity: available - quantity }, movement, soldItem);
    } catch (error) {
      notify(error instanceof Error ? error.message : '金额不正确');
    }
  }
  return (
    <Modal title={`部分售出 · ${item.name}`} onClose={onClose}>
      <form
        className="ledger-quantity-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(submit);
        }}
      >
        <div className="sale-preview">
          <span>预计净收益</span>
          <b className={estimate < 0 ? 'loss' : 'gain'}>
            {estimate >= 0 ? '+' : ''}
            {money(estimate)}
          </b>
          <small>售出后剩余 {Number.isFinite(quantity) ? available - quantity : '—'} 件</small>
        </div>
        <div className="two">
          <FormInput
            label={`售出数量（现有 ${available} 件）`}
            type="number"
            value={form.quantity}
            onChange={(value) => set('quantity', value)}
          />
          <FormInput
            label="单件成交价（元）"
            type="number"
            value={form.unitSale}
            onChange={(value) => set('unitSale', value)}
          />
        </div>
        <div className="two">
          <FormInput
            label="卖出日期"
            type="date"
            value={form.saleDate}
            onChange={(value) => set('saleDate', value)}
          />
          <FormInput
            label="销售平台（可选）"
            value={form.platform}
            onChange={(value) => set('platform', value)}
          />
        </div>
        <div className="three">
          <label>
            邮费计费方式
            <select
              value={form.shippingMode}
              onChange={(event) => set('shippingMode', event.target.value)}
            >
              <option value="per_order">按单</option>
              <option value="per_unit">按件</option>
            </select>
          </label>
          <FormInput
            label="邮费（元）"
            type="number"
            value={form.shipping}
            onChange={(value) => set('shipping', value)}
          />
          <label>
            平台费方式
            <select
              value={form.platformFeeMode}
              onChange={(event) => set('platformFeeMode', event.target.value)}
            >
              <option value="fixed">固定金额</option>
              <option value="percent">销售额比例</option>
            </select>
          </label>
        </div>
        <div className="three">
          <FormInput
            label={form.platformFeeMode === 'percent' ? '平台费比例（%）' : '平台费（元）'}
            type="number"
            value={form.platformFee}
            onChange={(value) => set('platformFee', value)}
          />
          <label>
            其他费方式
            <select
              value={form.otherFeeMode}
              onChange={(event) => set('otherFeeMode', event.target.value)}
            >
              <option value="per_order">按单</option>
              <option value="per_unit">按件</option>
            </select>
          </label>
          <FormInput
            label="其他费用（元）"
            type="number"
            value={form.otherFee}
            onChange={(value) => set('otherFee', value)}
          />
        </div>
        <FormInput
          label="备注（可选）"
          value={form.note}
          onChange={(value) => set('note', value)}
        />
        <SalePaymentFields
          payment={payment}
          onChange={setPayment}
          expected={Math.max(0, calculation.saleCents - calculation.platformFeeCents)}
        />
        <AsyncButton className="primary wide" type="submit">
          确认部分售出
        </AsyncButton>
      </form>
    </Modal>
  );
}

function InventoryAdjustmentModal({
  item,
  onClose,
  onSave,
}: {
  item: Item;
  onClose: () => void;
  onSave: (item: Item, movement: InventoryMovement) => Promise<void>;
}) {
  const { run } = useAction();
  const { notify } = useFeedback();
  const before = item.quantity ?? 1;
  const [kind, setKind] = useState<'stock_in' | 'adjustment'>('stock_in');
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');
  const amountNumber = Number(amount);
  const after = kind === 'stock_in' ? before + amountNumber : amountNumber;
  const delta = after - before;
  async function submit() {
    if (!Number.isSafeInteger(amountNumber) || amountNumber < 1) {
      notify(kind === 'stock_in' ? '补货数量必须是大于 0 的整数' : '盘点后的库存至少为 1');
      return;
    }
    if (delta === 0) {
      notify('调整后的库存数量没有变化');
      return;
    }
    await onSave(
      { ...item, quantity: after },
      {
        id: crypto.randomUUID(),
        itemId: item.id,
        kind,
        quantityDelta: delta,
        quantityBefore: before,
        quantityAfter: after,
        unitCents: item.purchaseCents,
        shippingCents: 0,
        platformFeeValue: 0,
        otherFeeCents: 0,
        note: note.trim() || undefined,
        createdAt: Date.now(),
      },
    );
  }
  return (
    <Modal title={`调整库存 · ${item.name}`} onClose={onClose}>
      <form
        className="ledger-quantity-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(submit);
        }}
      >
        <div className="sale-preview inventory-adjustment-preview">
          <span>当前库存</span>
          <b>{before} 件</b>
          <small>单件成本 {money(item.purchaseCents)}</small>
        </div>
        <label>
          操作类型
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="stock_in">补货入库</option>
            <option value="adjustment">盘点调整</option>
          </select>
        </label>
        <FormInput
          label={kind === 'stock_in' ? '新增数量' : '盘点后数量'}
          type="number"
          value={amount}
          onChange={setAmount}
        />
        <FormInput label="备注（可选）" value={note} onChange={setNote} />
        <p className="form-hint">
          变动后库存：<b>{Number.isFinite(after) ? after : '—'} 件</b>（{delta >= 0 ? '+' : ''}
          {Number.isFinite(delta) ? delta : '—'}）
        </p>
        <AsyncButton className="primary wide" type="submit">
          保存库存变动
        </AsyncButton>
      </form>
    </Modal>
  );
}
