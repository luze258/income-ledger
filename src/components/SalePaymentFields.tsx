import { useState } from 'react';
import type { Item } from '../types';
import { dateKey, centsToYuan, money } from '../domain';
import { expectedReceipt, validatePayment } from '../finance';
import { FormInput } from './Shared';
export function validatedSalePayment(
  payment: Partial<Item>,
  item: Item,
  saleDate: string,
  sale: { saleCents: number; platformFeeCents: number },
) {
  const fields =
    payment.paymentStatus === 'received'
      ? {
          ...payment,
          receivedDate: payment.receivedDate ?? dateKey(),
          receivedCents: payment.receivedCents ?? expectedReceipt({ ...item, ...sale }),
          settlementExpectedCents: expectedReceipt({ ...item, ...sale }),
          settlementReason: payment.settlementReason?.trim() || undefined,
        }
      : {
          paymentStatus: 'pending' as const,
          receivedDate: undefined,
          receivedCents: undefined,
          settlementExpectedCents: undefined,
          settlementReason: undefined,
        };
  validatePayment({ ...item, ...sale, ...fields, status: 'sold', saleDate });
  return fields;
}
export function SalePaymentFields({
  payment,
  onChange,
  expected,
}: {
  payment: Partial<Item>;
  onChange: (value: Partial<Item>) => void;
  expected: number;
}) {
  const [amount, setAmount] = useState('');
  return (
    <>
      <label>
        回款状态
        <select
          value={payment.paymentStatus ?? 'pending'}
          onChange={(e) =>
            onChange({ ...payment, paymentStatus: e.target.value as Item['paymentStatus'] })
          }
        >
          <option value="pending">待回款</option>
          <option value="received">已到账</option>
        </select>
      </label>
      {payment.paymentStatus === 'received' && (
        <>
          <FormInput
            label="实际到账日期"
            type="date"
            value={payment.receivedDate ?? dateKey()}
            onChange={(v) => onChange({ ...payment, receivedDate: v })}
          />
          <label>
            实际到账金额（元）
            <input
              type="number"
              step="0.01"
              value={amount || centsToYuan(expected)}
              onChange={(e) => {
                const value = e.target.value;
                setAmount(value);
                onChange({
                  ...payment,
                  receivedCents: value
                    ? /^\d+(\.\d{0,2})?$/.test(value)
                      ? Math.round(Number(value) * 100)
                      : NaN
                    : undefined,
                });
              }}
            />
          </label>
          <small>默认成交额扣除平台代扣费用；允许按真实流水调整，邮费和其他费用另计。</small>
          <FormInput
            label="结算差额原因（留空表示待核对）"
            value={payment.settlementReason ?? ''}
            onChange={(v) => onChange({ ...payment, settlementReason: v })}
          />
          <small>
            预计到账 {money(expected)} · 差额（实际－预计）{' '}
            {Number.isSafeInteger(payment.receivedCents ?? expected)
              ? money((payment.receivedCents ?? expected) - expected)
              : '金额无效'}
            。 有差额且原因留空时，该笔收益暂不计入已确认回款收益。
          </small>
        </>
      )}
    </>
  );
}
