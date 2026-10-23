import { paymentStatus, receiptReconciliation, validatePayment } from '../finance';
import React, { useEffect, useState } from 'react';

import { Image as ImageIcon } from 'lucide-react';
import {
  calculateSaleFromForm,
  centsToYuan,
  dateKey,
  inventoryDays,
  isDateKey,
  money,
  profitCents,
  yuanToCents,
} from '../domain';

import { loadItemImage } from '../storage';
import type { FeeTemplate, InventoryMovement, Item, ItemWrite, FinanceState } from '../types';
import { AsyncButton, useAction } from '../actions';
import { Modal } from '../components/Modal';

import { useFeedback } from '../feedback';

import { imageDataBytes, optimizeImage } from '../image';

import { FormInput, categoryColor, type OperationLog } from '../components/Shared';
import { SalePaymentFields, validatedSalePayment } from '../components/SalePaymentFields';

export function ItemModal({
  title,
  item,
  categories,
  onClose,
  onSave,
}: {
  title: string;
  item?: Item;
  categories: string[];
  onClose: () => void;
  onSave: (item: Omit<ItemWrite, 'id' | 'status' | 'createdAt'>) => Promise<void>;
}) {
  const { run } = useAction();
  const { notify } = useFeedback();
  const [form, setForm] = useState({
    name: item?.name ?? '',
    category: item?.category ?? categories[0] ?? '',
    purchase: item ? centsToYuan(item.purchaseCents) : '',
    quantity: String(item?.quantity ?? 1),
    purchaseDate: item?.purchaseDate ?? dateKey(),
    expectedSale: item?.expectedSaleCents == null ? '' : centsToYuan(item.expectedSaleCents),
    platform: item?.platform ?? '',
    note: item?.note ?? '',
    tags: item?.tags.join('，') ?? '',
    imageData: item?.imageData ?? '',
    sale: item?.saleCents == null ? '' : centsToYuan(item.saleCents),
    saleDate: item?.saleDate ?? '',
    shipping: centsToYuan(item?.shippingCents),
    platformFee: centsToYuan(item?.platformFeeCents),
    otherFee: centsToYuan(item?.otherFeeCents),
  });
  const [imageChanged, setImageChanged] = useState(false);
  const [imageLoading, setImageLoading] = useState(Boolean(item && item.imageData === undefined));
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!item || item.imageData !== undefined || imageChanged) return;
    let cancelled = false;
    setImageLoading(true);
    loadItemImage(item.id)
      .then((image) => {
        if (!cancelled)
          setForm((current) => (imageChanged ? current : { ...current, imageData: image ?? '' }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setImageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, imageChanged]);
  function chooseImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      notify('原始图片不能超过 12 MB');
      return;
    }
    void optimizeImage(file)
      .then((data) => {
        if (imageDataBytes(data) > 5 * 1024 * 1024) throw new Error('压缩后图片仍超过 5 MB');
        setImageChanged(true);
        set('imageData', data);
      })
      .catch((error) => notify(error instanceof Error ? error.message : '图片处理失败'));
  }
  async function submit() {
    try {
      if (!isDateKey(form.purchaseDate)) {
        notify('请选择有效的购入日期');
        return;
      }
      if (!form.name.trim() || !form.category) {
        notify('请输入商品名称并选择分类');
        return;
      }
      const quantity = Number(form.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        notify('数量必须是大于 0 的整数');
        return;
      }
      const draft = {
        name: form.name.trim(),
        category: form.category,
        purchaseCents: yuanToCents(form.purchase),
        quantity,
        purchaseDate: form.purchaseDate,
        expectedSaleCents: form.expectedSale ? yuanToCents(form.expectedSale) : undefined,
        platform: form.platform.trim() || undefined,
        note: form.note.trim() || undefined,
        tags: form.tags
          .split(/[,，]/)
          .map((x) => x.trim())
          .filter(Boolean),
        ...(item && !imageChanged
          ? {}
          : { imageData: form.imageData || (item ? null : undefined) }),
        ...(item?.status === 'sold'
          ? {
              saleCents: yuanToCents(form.sale),
              saleDate: form.saleDate,
              shippingCents: yuanToCents(form.shipping),
              platformFeeCents: yuanToCents(form.platformFee),
              otherFeeCents: yuanToCents(form.otherFee),
            }
          : {}),
      };
      if (item?.status === 'sold' && (!form.saleDate || form.saleDate < form.purchaseDate)) {
        notify('卖出日期不能早于购入日期');
        return;
      }
      if (item) validatePayment({ ...item, ...draft });
      await onSave(draft);
    } catch (error) {
      notify(error instanceof Error ? error.message : '表单内容不正确');
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="phase2-item-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(submit);
        }}
      >
        <FormInput label="商品名称" value={form.name} onChange={(v) => set('name', v)} />
        <div className="three">
          <FormInput
            label="购入价（元）"
            type="number"
            value={form.purchase}
            onChange={(v) => set('purchase', v)}
          />
          <FormInput
            label="数量"
            type="number"
            value={form.quantity}
            onChange={(v) => set('quantity', v)}
          />
          <FormInput
            label="购入日期"
            type="date"
            value={form.purchaseDate}
            onChange={(v) => set('purchaseDate', v)}
          />
          <small>用于计算周转时，应填写实际付款日期。</small>
        </div>
        <div className="two">
          <label>
            分类
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {categories.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <details className="supplementary-fields">
          <summary>
            补充信息（已填写{' '}
            {
              [form.expectedSale, form.platform, form.tags, form.note, form.imageData].filter(
                Boolean,
              ).length
            }{' '}
            项）
          </summary>
          <FormInput
            label="预计售价（元，可选）"
            type="number"
            value={form.expectedSale}
            onChange={(v) => set('expectedSale', v)}
          />
          <FormInput
            label="销售平台（可选）"
            value={form.platform}
            onChange={(v) => set('platform', v)}
          />
          <FormInput label="标签（逗号分隔）" value={form.tags} onChange={(v) => set('tags', v)} />
          <FormInput label="备注（可选）" value={form.note} onChange={(v) => set('note', v)} />
          <label className="image-picker">
            <span>商品图片或购买凭证（原图最大 12 MB，会自动压缩至 5 MB 内）</span>
            <input type="file" accept="image/*" onChange={chooseImage} />
            {imageLoading ? (
              <div className="image-placeholder">正在读取现有图片…</div>
            ) : form.imageData ? (
              <div className="image-preview">
                <img src={form.imageData} alt="商品图片预览" />
                <AsyncButton
                  className="danger"
                  onClick={() => {
                    setImageChanged(true);
                    set('imageData', '');
                  }}
                >
                  移除图片
                </AsyncButton>
              </div>
            ) : (
              <div className="image-placeholder">
                <ImageIcon size={20} />
                选择图片
              </div>
            )}
          </label>
        </details>
        {item?.status === 'sold' && (
          <>
            <div className="two">
              <FormInput
                label="卖出价"
                type="number"
                value={form.sale}
                onChange={(v) => set('sale', v)}
              />
              <FormInput
                label="卖出日期"
                type="date"
                value={form.saleDate}
                onChange={(v) => set('saleDate', v)}
              />
            </div>
            <div className="three">
              <FormInput
                label="邮费"
                type="number"
                value={form.shipping}
                onChange={(v) => set('shipping', v)}
              />
              <FormInput
                label="平台手续费"
                type="number"
                value={form.platformFee}
                onChange={(v) => set('platformFee', v)}
              />
              <FormInput
                label="其他费用"
                type="number"
                value={form.otherFee}
                onChange={(v) => set('otherFee', v)}
              />
            </div>
          </>
        )}
        <AsyncButton className="primary full" type="submit">
          保存
        </AsyncButton>
      </form>
    </Modal>
  );
}

export function ItemDetailModal({
  item,
  logs,
  movements,
  finance,
  onClose,
}: {
  finance: FinanceState;
  item: Item;
  logs: OperationLog[];
  movements: InventoryMovement[];
  onClose: () => void;
}) {
  const [section, setSection] = useState<'overview' | 'transaction' | 'attachments' | 'history'>(
    'overview',
  );
  const reconciliation = receiptReconciliation(item, finance);
  const [image, setImage] = useState(item.imageData);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    if (item.imageData) return;
    void loadItemImage(item.id)
      .then(setImage)
      .catch(() => {});
  }, [item]);
  return (
    <Modal title="商品详情" onClose={onClose}>
      <div className="period-tabs" role="tablist" aria-label="商品详情分区">
        {(
          [
            ['overview', '概览'],
            ['transaction', '交易与回款'],
            ['attachments', '图片与备注'],
            ['history', '变动记录'],
          ] as const
        ).map(([key, label]) => (
          <AsyncButton
            key={key}
            role="tab"
            id={`detail-tab-${key}`}
            aria-selected={section === key}
            aria-controls={`detail-panel-${key}`}
            className={section === key ? 'selected' : ''}
            onClick={() => setSection(key)}
          >
            {label}
          </AsyncButton>
        ))}
      </div>
      <div
        role="tabpanel"
        id="detail-panel-attachments"
        aria-labelledby="detail-tab-attachments"
        hidden={section !== 'attachments'}
      >
        {image && (
          <button
            className="detail-image-button"
            type="button"
            onClick={() => setPreviewOpen(true)}
            title="点击放大图片"
          >
            <img className="detail-image" src={image} alt={`${item.name} 的商品图片，点击放大`} />
          </button>
        )}
        {!image && <p className="muted">暂无商品图片或凭证。</p>}
        {item.tags.length > 0 && (
          <div className="tag-list">
            {item.tags.map((tag, index) => (
              <span key={index}>{tag}</span>
            ))}
          </div>
        )}
        <p className="detail-note">{item.note || '暂无备注。'}</p>
      </div>
      <div
        role="tabpanel"
        id="detail-panel-overview"
        aria-labelledby="detail-tab-overview"
        hidden={section !== 'overview'}
      >
        <h3>{item.name}</h3>
        <div className="detail-grid">
          <span>
            分类<b style={{ color: categoryColor(item.category) }}>{item.category}</b>
          </span>
          <span>
            状态<b>{item.status === 'sold' ? '已售出' : '库存中'}</b>
          </span>
          <span>
            购入单价<b>{money(item.purchaseCents)}</b>
          </span>
          <span>
            购入日期<b>{item.purchaseDate}</b>
          </span>
          {item.status === 'sold' && (
            <>
              <span>
                销售额<b>{money(item.saleCents ?? 0)}</b>
              </span>
              <span>
                净收益
                <b className={profitCents(item) >= 0 ? 'gain' : 'loss'}>
                  {money(profitCents(item))}
                </b>
              </span>
            </>
          )}
          {item.status === 'in_stock' && (
            <span>
              库存时间<b>{inventoryDays(item)} 天</b>
            </span>
          )}
          <span>
            数量<b>{item.quantity ?? 1} 件</b>
          </span>
        </div>
      </div>
      <div
        role="tabpanel"
        id="detail-panel-transaction"
        aria-labelledby="detail-tab-transaction"
        hidden={section !== 'transaction'}
      >
        {item.status === 'sold' ? (
          <>
            <div className="detail-grid">
              <span>
                卖出日期<b>{item.saleDate}</b>
              </span>
              <span>
                销售平台<b>{item.platform || '未填写'}</b>
              </span>
              <span>
                销售额<b>{money(item.saleCents ?? 0)}</b>
              </span>
              <span>
                邮费<b>{money(item.shippingCents ?? 0)}</b>
              </span>
              <span>
                平台手续费<b>{money(item.platformFeeCents ?? 0)}</b>
              </span>
              <span>
                其他费用<b>{money(item.otherFeeCents ?? 0)}</b>
              </span>
              <span>
                回款状态
                <b>
                  {paymentStatus(item) === 'received'
                    ? '已回款'
                    : paymentStatus(item) === 'pending'
                      ? '待回款'
                      : '历史回款待确认'}
                </b>
              </span>
              <span>
                预计到账<b>{money(reconciliation.expectedCents)}</b>
              </span>
              {paymentStatus(item) === 'received' && (
                <>
                  <span>
                    实际到账<b>{money(item.receivedCents ?? 0)}</b>
                  </span>
                  <span>
                    到账日期<b>{item.receivedDate}</b>
                  </span>
                  <span>
                    结算差额<b>{money(reconciliation.differenceCents)}</b>
                  </span>
                  <span>
                    核对状态
                    <b>
                      {reconciliation.status === 'pending'
                        ? '差额待核对'
                        : reconciliation.status === 'explained'
                          ? '已说明差额'
                          : '金额一致'}
                    </b>
                  </span>
                </>
              )}
            </div>
            {item.settlementReason && <p>差额原因：{item.settlementReason}</p>}
            <p className="muted">
              售出净收益包含待回款，已确认回款净收益以回款管理中的核对结果为准。
            </p>
          </>
        ) : (
          <p>
            当前商品尚未售出。
            {item.expectedSaleCents != null ? `预计售价 ${money(item.expectedSaleCents)}` : ''}
          </p>
        )}
        <h3>关联售后</h3>
        {finance.afterSales
          .filter((record) => record.itemId === item.id)
          .map((record) => (
            <p key={record.id}>
              {record.date} ·{' '}
              {record.kind === 'return'
                ? '退货退款'
                : record.kind === 'partial_refund'
                  ? '部分退款'
                  : '报损'}{' '}
              · {record.reason} · 退款 {money(record.refundCents)} · 损失 {money(record.lossCents)}
            </p>
          ))}
        {!finance.afterSales.some((record) => record.itemId === item.id) && (
          <p className="muted">暂无关联售后。</p>
        )}
      </div>
      <div
        role="tabpanel"
        id="detail-panel-history"
        aria-labelledby="detail-tab-history"
        hidden={section !== 'history'}
      >
        <h3>库存变动</h3>
        {movements.slice(0, 8).map((movement) => (
          <div className="detail-log" key={movement.id}>
            {movement.kind === 'stock_in'
              ? '补货入库'
              : movement.kind === 'adjustment'
                ? '盘点调整'
                : '部分售出'}{' '}
            {movement.quantityDelta > 0 ? '+' : ''}
            {movement.quantityDelta} 件（{movement.quantityBefore} → {movement.quantityAfter}）
            <small>
              {new Date(movement.createdAt).toLocaleString('zh-CN')}
              {movement.note ? ` · ${movement.note}` : ''}
            </small>
          </div>
        ))}
        {!movements.length && <small className="muted">暂无库存变动记录。</small>}
        <h3>操作历史</h3>
        {logs.slice(0, 8).map((log) => (
          <div className="detail-log" key={log.id}>
            {log.action}
            <small>{new Date(log.at).toLocaleString('zh-CN')}</small>
          </div>
        ))}
        {!logs.length && <small className="muted">此版本开始记录商品操作历史。</small>}
      </div>
      <small className="muted">
        创建于 {new Date(item.createdAt).toLocaleString('zh-CN')} · 商品操作会即时保存
      </small>
      {previewOpen && image && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="商品图片放大预览"
          onClick={() => setPreviewOpen(false)}
        >
          <img src={image} alt={`${item.name} 的商品图片放大预览`} />
        </div>
      )}
    </Modal>
  );
}

export function SellModal({
  item,
  templates,
  onClose,
  onSave,
}: {
  item: Item;
  templates: FeeTemplate[];
  onClose: () => void;
  onSave: (changes: Partial<Item>) => Promise<void>;
}) {
  const [payment, setPayment] = useState<Partial<Item>>({ paymentStatus: 'pending' });
  const { run } = useAction();
  const { notify } = useFeedback();
  const [form, setForm] = useState({
    template: '',
    sale: item.expectedSaleCents == null ? '' : centsToYuan(item.expectedSaleCents),
    shipping: '0.00',
    platformFee: '0.00',
    otherFee: '0.00',
    saleDate: dateKey(),
    platform: item.platform ?? '',
  });
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  function applyTemplate(id: string) {
    const template = templates.find((x) => x.id === id);
    setForm((current) =>
      template
        ? {
            ...current,
            template: id,
            platform: template.platform,
            shipping: centsToYuan(template.shippingCents),
            platformFee: centsToYuan(template.platformFeeCents),
            otherFee: centsToYuan(template.otherFeeCents),
          }
        : { ...current, template: '' },
    );
  }
  let calculation = {
    saleCents: 0,
    shippingCents: 0,
    platformFeeCents: 0,
    otherFeeCents: 0,
    profitCents: -item.purchaseCents * (item.quantity ?? 1),
  };
  try {
    calculation = calculateSaleFromForm({
      quantity: item.quantity ?? 1,
      unitPurchaseCents: item.purchaseCents,
      unitSale: form.sale,
      shipping: form.shipping,
      platformFee: form.platformFee,
      otherFee: form.otherFee,
    });
  } catch {
    /* validation runs on save */
  }
  async function submit() {
    try {
      if (!isDateKey(form.saleDate) || form.saleDate < item.purchaseDate) {
        notify('请选择不早于购入日期的有效卖出日期');
        return;
      }
      const submittedCalculation = calculateSaleFromForm({
        quantity: item.quantity ?? 1,
        unitPurchaseCents: item.purchaseCents,
        unitSale: form.sale,
        shipping: form.shipping,
        platformFee: form.platformFee,
        otherFee: form.otherFee,
      });
      await onSave({
        saleCents: submittedCalculation.saleCents,
        shippingCents: submittedCalculation.shippingCents,
        platformFeeCents: submittedCalculation.platformFeeCents,
        otherFeeCents: submittedCalculation.otherFeeCents,
        ...validatedSalePayment(payment, item, form.saleDate, submittedCalculation),
        saleDate: form.saleDate,
        platform: form.platform.trim() || undefined,
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : '金额不正确');
    }
  }
  return (
    <Modal title={`售出 · ${item.name}`} onClose={onClose}>
      <form
        className="phase2-item-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(submit);
        }}
      >
        <div className="sale-preview">
          <span>预计净收益</span>
          <b className={calculation.profitCents < 0 ? 'loss' : 'gain'}>
            {calculation.profitCents >= 0 ? '+' : ''}
            {money(calculation.profitCents)}
          </b>
          <small>本次售出 {item.quantity ?? 1} 件</small>
        </div>
        {templates.length > 0 && (
          <label>
            费用模板
            <select value={form.template} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">不使用模板</option>
              {templates.map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name} · {x.platform}
                </option>
              ))}
            </select>
          </label>
        )}
        <FormInput label="销售平台" value={form.platform} onChange={(v) => set('platform', v)} />
        <div className="two">
          <FormInput
            label="单件成交价（元）"
            type="number"
            value={form.sale}
            onChange={(v) => set('sale', v)}
          />
          <FormInput
            label="卖出日期"
            type="date"
            value={form.saleDate}
            onChange={(v) => set('saleDate', v)}
          />
        </div>
        <div className="three">
          <FormInput
            label="邮费"
            type="number"
            value={form.shipping}
            onChange={(v) => set('shipping', v)}
          />
          <FormInput
            label="平台手续费"
            type="number"
            value={form.platformFee}
            onChange={(v) => set('platformFee', v)}
          />
          <FormInput
            label="其他费用"
            type="number"
            value={form.otherFee}
            onChange={(v) => set('otherFee', v)}
          />
        </div>
        <SalePaymentFields
          payment={payment}
          onChange={setPayment}
          expected={Math.max(0, calculation.saleCents - calculation.platformFeeCents)}
        />
        <AsyncButton className="primary full" type="submit">
          确认售出
        </AsyncButton>
      </form>
    </Modal>
  );
}
