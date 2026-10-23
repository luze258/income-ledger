export type LedgerPreferences = {
  pageSize: 10 | 20 | 50;
  stagnantDays: number;
  lowProfitCents: number;
  lowStockCount: number;
  lastTab: string;
};

export const defaultPreferences: LedgerPreferences = {
  pageSize: 10,
  stagnantDays: 30,
  lowProfitCents: 0,
  lowStockCount: 0,
  lastTab: '首页',
};

const key = 'income-ledger-preferences';

export function loadPreferences(): LedgerPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}') as Partial<LedgerPreferences>;
    const pageSize = [10, 20, 50].includes(saved.pageSize ?? 10)
      ? (saved.pageSize as LedgerPreferences['pageSize'])
      : 10;
    return {
      ...defaultPreferences,
      ...saved,
      pageSize,
      stagnantDays: Math.max(1, Number(saved.stagnantDays ?? defaultPreferences.stagnantDays)),
      lowProfitCents: Math.max(0, Number(saved.lowProfitCents ?? 0)),
      lowStockCount: Math.max(0, Number(saved.lowStockCount ?? 0)),
    };
  } catch {
    return defaultPreferences;
  }
}

export function savePreferences(preferences: LedgerPreferences) {
  localStorage.setItem(key, JSON.stringify(preferences));
}
