export type ItemStatus = 'in_stock' | 'sold';

export type Item = {
  id: string;
  name: string;
  category: string;
  purchaseCents: number;
  /** 同一条记录代表的商品数量；旧数据缺省时按 1 处理。 */
  quantity?: number;
  purchaseDate: string;
  status: ItemStatus;
  expectedSaleCents?: number;
  saleCents?: number;
  shippingCents?: number;
  platformFeeCents?: number;
  otherFeeCents?: number;
  saleDate?: string;
  paymentStatus?: 'pending' | 'received' | 'historical';
  receivedDate?: string;
  receivedCents?: number;
  /** 核对时的预计结算额（扣平台费、未扣售后退款），旧记录缺省时按原成交计算。 */
  settlementExpectedCents?: number;
  /** 实际到账与预计额不一致时的核对原因；留空表示待核对。 */
  settlementReason?: string;
  platform?: string;
  note?: string;
  tags: string[];
  imageData?: string;
  createdAt: number;
  deletedAt?: number;
};

/**
 * SQLite 写入载荷：省略 imageData 代表不修改已有图片，null 代表明确删除图片。
 * JSON.stringify 会保留 null、忽略 undefined，因而不能用 Item 直接表达此语义。
 */
export type ItemWrite = Omit<Item, 'imageData'> & {
  imageData?: string | null;
};

/** 库存变动仅追加，不覆盖既有商品，以便库存与成本能被追溯。 */
export type InventoryMovementKind = 'stock_in' | 'adjustment' | 'partial_sale';
export type PerOrderOrUnit = 'per_order' | 'per_unit';
export type FixedOrPercent = 'fixed' | 'percent';

export type InventoryMovement = {
  id: string;
  itemId: string;
  kind: InventoryMovementKind;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  /** 单件进货价或售价，单位为分。 */
  unitCents?: number;
  shippingCents: number;
  shippingMode?: PerOrderOrUnit;
  /** 固定模式为分；百分比模式为万分比，例如 5% 记为 500。 */
  platformFeeValue: number;
  platformFeeMode?: FixedOrPercent;
  otherFeeCents: number;
  otherFeeMode?: PerOrderOrUnit;
  note?: string;
  createdAt: number;
};

export type FeeTemplate = {
  id: string;
  name: string;
  platform: string;
  shippingCents: number;
  platformFeeCents: number;
  otherFeeCents: number;
  createdAt: number;
};

export type Backup = {
  format: 'income-ledger-backup';
  version: 1 | 2 | 3 | 4;
  exportedAt: string;
  items: Item[];
  categories: string[];
  templates: FeeTemplate[];
  /** v1 备份没有此字段；导入时按空历史处理。 */
  inventoryMovements?: InventoryMovement[];
  finance?: FinanceState;
  /** 新版完整备份显式记录每条商品的图片状态，null 表示该商品没有图片。 */
  imageDataByItemId?: Record<string, string | null>;
};
export type AfterSale = {
  id: string;
  itemId: string;
  kind: 'return' | 'partial_refund' | 'write_off';
  date: string;
  refundCents: number;
  quantity: number;
  lossCents: number;
  reason: string;
  /** 退款已由平台直接从实际到账额中扣除，用于避免二次扣减。 */
  deductedFromReceipt?: boolean;
  returnedItemId?: string;
  /** 退回商品确认收回的日期；缺省表示尚未收回。 */
  recoveredDate?: string;
};
export type FinanceState = {
  capitalLimitCents: number;
  cashCents?: number;
  cashCheckedDate?: string;
  afterSales: AfterSale[];
};
export type ParsedImport = {
  items: Item[];
  errors: string[];
  missingIds?: string[];
  backup?: Backup;
};

export type ImportPreview = {
  source: 'json' | 'csv' | 'xlsx';
  mode: 'replace' | 'merge';
  items: Item[];
  added: number;
  skipped: number;
  overwritten: number;
  errors: string[];
  suspected?: Item[];
  backup?: Backup;
};
