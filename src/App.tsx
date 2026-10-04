import React, { useEffect, useMemo, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { appConfigDir } from '@tauri-apps/api/path';
import { save as showSaveDialog } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import {
  BarChart3,
  Boxes,
  Image as ImageIcon,
  LayoutDashboard,
  Package,
  Plus,
  Settings,
  Tags,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  buildImportPreview,
  calculateSaleFromForm,
  centsToYuan,
  dateKey,
  inventoryDays,
  isDateKey,
  marginPercent,
  money,
  monthKey,
  monthKeyOffset,
  monthlySummary,
  parseDateKey,
  profitCents,
  yearlySummary,
  yuanToCents,
} from './domain';
import {
  exportBackup,
  exportCsv,
  exportExcel,
  parseCsvItems,
  parseExcelItems,
  parseJsonItems,
} from './importExport';
import {
  restoreBackup,
  changeItemCategories,
  initializeStorage,
  isTauriRuntime,
  loadBackupItems,
  loadItemImage,
  permanentlyDeleteItems,
  persistItem,
  recordInventoryMovement,
  replacePersistedItems,
  restoreItems,
  saveCategories,
  saveFeeTemplates,
  softDeleteItems,
  type StorageBackend,
} from './storage';
import type { FeeTemplate, ImportPreview, InventoryMovement, Item, ItemWrite } from './types';
import { AsyncButton, ActionProvider, useAction } from './actions';
import { Modal } from './components/Modal';
import { Thumb } from './components/Thumb';
import { Products } from './components/Products';
import { Pagination } from './components/Pagination';
import { FeedbackProvider, useFeedback } from './feedback';
import { loadPreferences, savePreferences, type LedgerPreferences } from './preferences';
import { imageDataBytes, optimizeImage } from './image';
import packageJson from '../package.json';

type ThemeName = 'system' | 'forest' | 'ocean' | 'warm' | 'mint' | 'violet' | 'contrast';
type OperationLog = { id: string; itemId: string; action: string; at: number };
type UndoAction = { label: string; undo: () => Promise<void> };
const themeNames: Array<[ThemeName, string]> = [
  ['system', '跟随系统'],
  ['forest', '森林绿'],
  ['ocean', '深海蓝'],
  ['warm', '暖棕'],
  ['mint', '薄荷绿'],
  ['violet', '紫罗兰'],
  ['contrast', '高对比'],
];
const categoryColor = (category: string) =>
  ['#397049', '#277da1', '#a15c35', '#7a5aa6', '#b05b72', '#188977'][
    [...category].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6
  ];

async function saveOutput(
  name: string,
  extension: string,
  filterName: string,
  contents: string | Uint8Array,
  mime: string,
) {
  if (isTauriRuntime()) {
    const path = await showSaveDialog({
      defaultPath: name,
      filters: [{ name: filterName, extensions: [extension] }],
    });
    if (!path) return false;
    if (typeof contents === 'string') await writeTextFile(path, contents);
    else await writeFile(path, contents);
    return true;
  }
  const url = URL.createObjectURL(new Blob([contents as BlobPart], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

export default function App() {
  return (
    <FeedbackProvider>
      <ActionProvider>
        <LedgerApp />
      </ActionProvider>
    </FeedbackProvider>
  );
}
function LedgerApp() {
  const { notify, confirm } = useFeedback();
  const [items, setItems] = useState<Item[]>([]);
  const [savedCategories, setCategories] = useState<string[]>([]);
  const categories = [...new Set([...savedCategories, ...items.map((item) => item.category)])];
  const [templates, setTemplates] = useState<FeeTemplate[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [backend, setBackend] = useState<StorageBackend>('localStorage');
  const [appVersion, setAppVersion] = useState(packageJson.version);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [preferences, setPreferences] = useState<LedgerPreferences>(loadPreferences);
  const [tab, setTab] = useState(() => loadPreferences().lastTab);
  const [productJump, setProductJump] = useState<'stagnant' | 'lowProfit' | 'stock' | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [sellItem, setSellItem] = useState<Item | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [imageRevisions, setImageRevisions] = useState<Record<string, number>>({});
  const [theme, setTheme] = useState<ThemeName>(
    () => (localStorage.getItem('income-ledger-theme') as ThemeName) || 'system',
  );
  const [accent, setAccent] = useState(
    () => localStorage.getItem('income-ledger-accent') || '#397049',
  );
  const [sidebar, setSidebar] = useState(
    () => localStorage.getItem('income-ledger-sidebar') || '#18352a',
  );
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem('income-ledger-operation-logs') || '[]',
      ) as OperationLog[];
    } catch {
      return [];
    }
  });
  const [skipRecycleConfirm, setSkipRecycleConfirm] = useState(
    () => localStorage.getItem('income-ledger-skip-recycle-confirm') === 'true',
  );
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void getVersion().then(setAppVersion).catch(() => undefined);
  }, []);
  useEffect(() => {
    localStorage.setItem('income-ledger-theme', theme);
    localStorage.setItem('income-ledger-accent', accent);
    localStorage.setItem('income-ledger-sidebar', sidebar);
  }, [theme, accent, sidebar]);
  useEffect(() => {
    localStorage.setItem('income-ledger-skip-recycle-confirm', String(skipRecycleConfirm));
  }, [skipRecycleConfirm]);
  useEffect(() => {
    savePreferences({ ...preferences, lastTab: tab });
  }, [preferences, tab]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setAddOpen(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const logOperation = (itemId: string, action: string) =>
    setOperationLogs((current) => {
      const next = [{ id: crypto.randomUUID(), itemId, action, at: Date.now() }, ...current].slice(
        0,
        300,
      );
      localStorage.setItem('income-ledger-operation-logs', JSON.stringify(next));
      return next;
    });

  useEffect(() => {
    initializeStorage()
      .then((result) => {
        setItems(result.items);
        setCategories(result.categories);
        setTemplates(result.templates);
        setInventoryMovements(result.inventoryMovements);
        setBackend(result.backend);
        setReady(true);
        if (result.warning) notify(result.warning);
      })
      .catch((error) => setLoadError(String(error)));
  }, []);

  const active = items.filter((item) => !item.deletedAt);
  const trash = items.filter((item) => item.deletedAt);
  const sold = active.filter((item) => item.status === 'sold');
  const inventory = active.filter((item) => item.status === 'in_stock');

  async function upsert(item: ItemWrite, action = '更新商品', undoPrevious?: Item) {
    await persistItem(item);
    if (item.imageData !== undefined) {
      setImageRevisions((current) => ({ ...current, [item.id]: (current[item.id] ?? 0) + 1 }));
    }
    const itemForList: Item =
      item.imageData === null ? (({ imageData: _, ...rest }) => rest)(item) : item;
    setItems((current) =>
      current.some((x) => x.id === item.id)
        ? current.map((x) => (x.id === item.id ? itemForList : x))
        : [itemForList, ...current],
    );
    logOperation(item.id, action);
    if (undoPrevious) {
      setUndoAction({
        label: `撤销${action}`,
        undo: async () => {
          await persistItem(undoPrevious);
          setItems((current) =>
            current.map((value) => (value.id === undoPrevious.id ? undoPrevious : value)),
          );
        },
      });
    } else if (action === '添加商品') {
      setUndoAction({
        label: '撤销添加商品',
        undo: async () => {
          await permanentlyDeleteItems([item.id]);
          setItems((current) => current.filter((value) => value.id !== item.id));
        },
      });
    }
  }
  async function remove(ids: string[]) {
    if (
      !skipRecycleConfirm &&
      !(await confirm(`将 ${ids.length} 条记录移入回收站？`, {
        suppressible: true,
        onSuppress: () => setSkipRecycleConfirm(true),
      }))
    )
      return;
    const deletedAt = await softDeleteItems(ids);
    setItems((current) =>
      current.map((item) => (ids.includes(item.id) ? { ...item, deletedAt } : item)),
    );
    ids.forEach((id) => logOperation(id, '移入回收站'));
    setUndoAction({
      label: `撤销移入回收站（${ids.length} 条）`,
      undo: async () => {
        await restoreItems(ids);
        setItems((current) =>
          current.map((item) => (ids.includes(item.id) ? { ...item, deletedAt: undefined } : item)),
        );
      },
    });
  }
  async function restore(ids: string[]) {
    await restoreItems(ids);
    setItems((current) =>
      current.map((item) => (ids.includes(item.id) ? { ...item, deletedAt: undefined } : item)),
    );
    ids.forEach((id) => logOperation(id, '从回收站恢复'));
    setUndoAction({
      label: `撤销恢复（${ids.length} 条）`,
      undo: async () => {
        const deletedAt = await softDeleteItems(ids);
        setItems((current) =>
          current.map((item) => (ids.includes(item.id) ? { ...item, deletedAt } : item)),
        );
      },
    });
  }
  async function purge(ids?: string[]) {
    if (
      !(await confirm(
        ids
          ? `永久删除所选 ${ids.length} 条记录？此操作无法撤销。`
          : '清空回收站？此操作无法撤销。',
      ))
    )
      return;
    await permanentlyDeleteItems(ids);
    setItems((current) =>
      current.filter((item) => !item.deletedAt || (ids && !ids.includes(item.id))),
    );
  }
  async function confirmImport(importPreview: ImportPreview) {
    if (importPreview.mode === 'replace' && importPreview.errors.length) return;
    if (importPreview.backup) {
      await restoreBackup(importPreview.backup);
      setItems(importPreview.backup.items);
      setCategories(importPreview.backup.categories);
      setTemplates(importPreview.backup.templates);
      setInventoryMovements(importPreview.backup.inventoryMovements ?? []);
      setImportPreview(null);
      notify('完整备份已恢复，包含商品、图片、回收站、分类、费用模板和库存变动');
      return;
    }
    const next =
      importPreview.mode === 'replace'
        ? [
            ...importPreview.items,
            ...trash.filter((old) => !importPreview.items.some((item) => item.id === old.id)),
          ]
        : [
            ...importPreview.items.filter(
              (incoming) => !items.some((item) => item.id === incoming.id),
            ),
            ...items,
          ];
    await replacePersistedItems(next);
    setItems(next);
    setImportPreview(null);
    const discarded = importPreview.errors.length;
    notify(
      `导入完成：新增 ${importPreview.added} 条，跳过 ${importPreview.skipped} 条` +
        (discarded ? `；另有 ${discarded} 条格式错误，未导入。` : ''),
    );
  }

  if (loadError)
    return <div className="loading-screen">账本打开失败：{loadError}。请重新启动应用。</div>;
  if (!ready) return <div className="loading-screen">正在打开收益账本…</div>;
  const pages: Array<[string, React.ElementType]> = [
    ['首页', LayoutDashboard],
    ['商品', Package],
    ['库存', Boxes],
    ['统计', BarChart3],
    ['回收站', Trash2],
    ['设置', Settings],
  ];
  return (
    <div
      className="app"
      data-theme={theme}
      style={{ '--accent': accent, '--sidebar': sidebar } as React.CSSProperties}
    >
      <aside>
        <div className="brand">
          <div className="logo">¥</div>
          <div>
            <b>收益账本</b>
            <small>桌面版 v{appVersion}</small>
          </div>
        </div>
        <nav>
          {pages.map(([label, Icon]) => (
            <AsyncButton
              className={tab === label ? 'active' : ''}
              onClick={() => {
                setTab(label);
                if (label !== '商品') setProductJump(null);
              }}
              key={label}
            >
              <Icon size={18} />
              {label}
              {label === '回收站' && trash.length > 0 ? ` (${trash.length})` : ''}
            </AsyncButton>
          ))}
        </nav>
        <div className="side-note">
          {backend === 'sqlite' ? '数据保存在本机数据库' : '当前为浏览器预览模式'}
          <br />
          无需账号或网络
          <br />
          作者：路泽
        </div>
      </aside>
      <main>
        <header>
          <div>
            <h1>{tab}</h1>
            <p>记录每一笔交易，看清真正的收益</p>
          </div>
          {tab !== '回收站' && (
            <AsyncButton className="primary" onClick={() => setAddOpen(true)}>
              <Plus size={18} />
              添加商品
            </AsyncButton>
          )}
        </header>
        {tab === '首页' && (
          <Dashboard
            items={active}
            preferences={preferences}
            onOpenProducts={(jump) => {
              setProductJump(jump);
              setTab('商品');
            }}
          />
        )}
        {tab === '商品' && (
          <Products
            items={active}
            categories={categories}
            onSell={setSellItem}
            onEdit={setEditItem}
            onDetails={setDetailItem}
            onDelete={(id) => remove([id])}
            onBatchDelete={remove}
            onBatchCategory={async (ids, category) => {
              await changeItemCategories(ids, category);
              setItems((all) => all.map((x) => (ids.includes(x.id) ? { ...x, category } : x)));
            }}
            onBatchUpdate={async (ids, changes) => {
              const previous = items.filter((item) => ids.includes(item.id));
              await Promise.all(previous.map((item) => persistItem({ ...item, ...changes })));
              setItems((all) =>
                all.map((item) => (ids.includes(item.id) ? { ...item, ...changes } : item)),
              );
              setUndoAction({
                label: `撤销批量更新（${ids.length} 条）`,
                undo: async () => {
                  await Promise.all(previous.map((item) => persistItem(item)));
                  setItems((all) =>
                    all.map((item) => previous.find((old) => old.id === item.id) ?? item),
                  );
                },
              });
            }}
            imageRevisions={imageRevisions}
            pageSize={preferences.pageSize}
            stagnantDays={preferences.stagnantDays}
            jump={productJump}
          />
        )}
        {tab === '库存' && (
          <InventoryPage
            items={active}
            preferences={preferences}
            pageSize={preferences.pageSize}
            movements={inventoryMovements}
            onDetails={setDetailItem}
            onInventoryChange={async (item, movement, soldItem) => {
              await recordInventoryMovement(item, movement, soldItem);
              setInventoryMovements((current) => [movement, ...current]);
              setItems((all) => [
                ...(soldItem ? [soldItem] : []),
                ...all.map((current) => (current.id === item.id ? item : current)),
              ]);
            }}
            onOpenProducts={() => {
              setProductJump('stock');
              setTab('商品');
            }}
          />
        )}
        {tab === '统计' && <Stats items={active} />}
        {tab === '回收站' && (
          <RecycleBin
            items={trash}
            onRestore={restore}
            onPurge={purge}
            pageSize={preferences.pageSize}
          />
        )}
        {tab === '设置' && (
          <SettingsPage
            items={items}
            backend={backend}
            categories={categories}
            templates={templates}
            inventoryMovements={inventoryMovements}
            onCategories={async (next) => {
              await saveCategories(next);
              setCategories(next);
            }}
            onTemplates={async (next) => {
              await saveFeeTemplates(next);
              setTemplates(next);
            }}
            onPreview={setImportPreview}
            skipRecycleConfirm={skipRecycleConfirm}
            onRestoreRecycleConfirm={() => setSkipRecycleConfirm(false)}
            theme={theme}
            accent={accent}
            onTheme={setTheme}
            onAccent={setAccent}
            sidebar={sidebar}
            onSidebar={setSidebar}
            preferences={preferences}
            onPreferences={setPreferences}
          />
        )}
      </main>
      {addOpen && (
        <ItemModal
          title="添加商品"
          categories={categories}
          onClose={() => setAddOpen(false)}
          onSave={async (draft) => {
            await upsert(
              {
                ...draft,
                id: crypto.randomUUID(),
                status: 'in_stock',
                tags: draft.tags ?? [],
                createdAt: Date.now(),
              },
              '添加商品',
            );
            setAddOpen(false);
          }}
        />
      )}
      {editItem && (
        <ItemModal
          title="编辑商品"
          item={editItem}
          categories={categories}
          onClose={() => setEditItem(null)}
          onSave={async (draft) => {
            await upsert({ ...editItem, ...draft }, '编辑商品', editItem);
            setEditItem(null);
          }}
        />
      )}
      {sellItem && (
        <SellModal
          item={sellItem}
          templates={templates}
          onClose={() => setSellItem(null)}
          onSave={async (changes) => {
            await upsert({ ...sellItem, ...changes, status: 'sold' }, '标记为已售出', sellItem);
            setSellItem(null);
          }}
        />
      )}
      {detailItem && (
        <ItemDetailModal
          item={detailItem}
          logs={operationLogs.filter((log) => log.itemId === detailItem.id)}
          movements={inventoryMovements.filter((movement) => movement.itemId === detailItem.id)}
          onClose={() => setDetailItem(null)}
        />
      )}
      {importPreview && (
        <ImportPreviewModal
          preview={importPreview}
          onClose={() => setImportPreview(null)}
          onConfirm={confirmImport}
        />
      )}
      {undoAction && (
        <div className="undo-bar" role="status">
          <span>{undoAction.label}</span>
          <AsyncButton
            className="outline"
            onClick={async () => {
              await undoAction.undo();
              setUndoAction(null);
              notify('已撤销上一步操作');
            }}
          >
            撤销
          </AsyncButton>
          <AsyncButton
            className="icon-btn"
            aria-label="关闭撤销提示"
            onClick={() => setUndoAction(null)}
          >
            ×
          </AsyncButton>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  items,
  preferences,
  onOpenProducts,
}: {
  items: Item[];
  preferences: LedgerPreferences;
  onOpenProducts: (jump: 'stagnant' | 'lowProfit' | 'stock') => void;
}) {
  const sold = items.filter((x) => x.status === 'sold');
  const inventory = items.filter((x) => x.status === 'in_stock');
  const monthSold = sold.filter((x) => x.saleDate?.startsWith(monthKey()));
  const monthProfit = monthSold.reduce((sum, x) => sum + profitCents(x), 0);
  const revenue = monthSold.reduce((sum, x) => sum + (x.saleCents ?? 0), 0);
  const invCost = inventory.reduce((sum, x) => sum + x.purchaseCents * (x.quantity ?? 1), 0);
  const months = Array.from({ length: 6 }, (_, index) => {
    const key = monthKeyOffset(-5 + index);
    return {
      key,
      label: `${Number(key.slice(5))}月`,
      value: sold
        .filter((x) => x.saleDate?.startsWith(key))
        .reduce((sum, x) => sum + profitCents(x), 0),
    };
  });
  const max = Math.max(1, ...months.map((x) => Math.abs(x.value)));
  const aged = inventory.filter((x) => inventoryDays(x) >= preferences.stagnantDays);
  const lowProfit = sold.filter((x) => profitCents(x) <= preferences.lowProfitCents);
  const priceToSet = inventory.filter((x) => x.expectedSaleCents == null);
  return (
    <>
      <section className="hero">
        <div>
          <span>本月净收益</span>
          <strong className={monthProfit < 0 ? 'loss' : ''}>{money(monthProfit)}</strong>
          <small>按卖出日期统计 · 金额以整数分存储</small>
        </div>
        <TrendingUp size={46} />
      </section>
      <div className="cards">
        <Card title="本月销售额" value={money(revenue)} icon={<Wallet />} />
        <Card
          title="本月售出"
          value={`${monthSold.reduce((sum, item) => sum + (item.quantity ?? 1), 0)} 件`}
          icon={<Package />}
        />
        <Card title="当前库存成本" value={money(invCost)} icon={<BarChart3 />} />
      </div>
      <ProfitGoal profit={monthProfit} />
      <section className="panel chart-panel">
        <Title title="收益趋势" note="最近 6 个月" />
        <div className="chart-bars">
          {months.map((x) => (
            <div className="chart-col" key={x.key}>
              <div className="chart-value">{x.value ? money(x.value) : '—'}</div>
              <div className="chart-track">
                <i style={{ height: `${Math.max(4, (Math.abs(x.value) / max) * 100)}%` }} />
              </div>
              <small>{x.label}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="panel inventory-alert">
        <div>
          <h2>长期库存提醒</h2>
          <p>
            {aged.length
              ? `${aged.reduce((sum, x) => sum + (x.quantity ?? 1), 0)} 件商品库存超过 ${preferences.stagnantDays} 天，占用资金 ${money(aged.reduce((sum, x) => sum + x.purchaseCents, 0))}`
              : `目前没有超过 ${preferences.stagnantDays} 天的库存`}
          </p>
        </div>
        <span className={aged.length ? 'alert-count' : 'ok-count'}>{aged.length}</span>
      </section>
      <section className="reminder-grid" aria-label="库存与收益提醒">
        <AsyncButton className="reminder-card" onClick={() => onOpenProducts('stock')}>
          <span>待售库存</span>
          <b>{inventory.reduce((sum, item) => sum + (item.quantity ?? 1), 0)}</b>
          <small>件可继续管理</small>
        </AsyncButton>
        <AsyncButton className="reminder-card" onClick={() => onOpenProducts('stagnant')}>
          <span>滞销提醒</span>
          <b>{aged.length}</b>
          <small>超过 {preferences.stagnantDays} 天</small>
        </AsyncButton>
        <AsyncButton className="reminder-card" onClick={() => onOpenProducts('lowProfit')}>
          <span>低利润/亏损</span>
          <b>{lowProfit.length}</b>
          <small>已售出商品</small>
        </AsyncButton>
        <div className="reminder-card">
          <span>待补预计售价</span>
          <b>{priceToSet.length}</b>
          <small>库存商品</small>
        </div>
      </section>
      <section className="panel">
        <Title title="最近交易" note={`${items.length} 条记录`} />
        {items.slice(0, 5).map((x) => (
          <div className="row" key={x.id}>
            <Thumb item={x} />
            <div className="grow">
              <b>{x.name}</b>
              <small>
                {x.category} · 购入 {money(x.purchaseCents)}
              </small>
            </div>
            <span className={x.status === 'sold' ? (profitCents(x) >= 0 ? 'gain' : 'loss') : ''}>
              {x.status === 'sold'
                ? `${profitCents(x) >= 0 ? '+' : ''}${money(profitCents(x))}`
                : '库存中'}
            </span>
          </div>
        ))}
        {!items.length && <Empty text="还没有商品记录，添加你的第一件商品吧" />}
      </section>
    </>
  );
}

function InventoryPage({
  items,
  preferences,
  pageSize,
  movements,
  onDetails,
  onInventoryChange,
  onOpenProducts,
}: {
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

  return (
    <>
      <div className="cards inventory-cards">
        <Card title="库存商品" value={`${inventory.length} 条`} icon={<Package />} />
        <Card title="可售数量" value={`${totalQuantity} 件`} icon={<Boxes />} />
        <Card title="库存成本" value={money(totalCost)} icon={<Wallet />} />
        <Card title="低库存（≤1件）" value={`${lowStock.length} 条`} icon={<TrendingUp />} />
      </div>
      <section className="panel inventory-overview">
        <Title title="库存概览" note="按单价 × 当前数量计算" />
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
            <span className="loss">{money(item.purchaseCents * (item.quantity ?? 1))}</span>
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
      <InventoryHistory movements={movements} items={items} />
    </>
  );
}

function InventoryHistory({ movements, items }: { movements: InventoryMovement[]; items: Item[] }) {
  const itemNames = new Map(items.map((item) => [item.id, item.name]));
  const labels: Record<InventoryMovement['kind'], string> = {
    stock_in: '补货入库',
    adjustment: '盘点调整',
    partial_sale: '部分售出',
  };
  return (
    <section className="panel inventory-history">
      <Title title="库存变动记录" note={`共 ${movements.length} 条`} />
      {movements.slice(0, 10).map((movement) => (
        <div className="row" key={movement.id}>
          <div className="inventory-movement-dot">{movement.quantityDelta > 0 ? '+' : '−'}</div>
          <div className="grow">
            <b>{itemNames.get(movement.itemId) ?? '已删除商品'}</b>
            <small>
              {labels[movement.kind]} · {new Date(movement.createdAt).toLocaleString('zh-CN')}
              {movement.note ? ` · ${movement.note}` : ''}
            </small>
          </div>
          <div className={movement.quantityDelta > 0 ? 'gain' : 'loss'}>
            {movement.quantityDelta > 0 ? '+' : ''}
            {movement.quantityDelta} 件
            <small>
              {movement.quantityBefore} → {movement.quantityAfter}
            </small>
          </div>
        </div>
      ))}
      {!movements.length && <Empty text="还没有库存变动记录。" />}
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
    <section className="panel inventory-list">
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

function ProfitGoal({ profit }: { profit: number }) {
  const [target, setTarget] = useState(() =>
    Number(localStorage.getItem('income-ledger-profit-goal') || 0),
  );
  const [editing, setEditing] = useState(false);
  const percent = target > 0 ? Math.min(100, Math.max(0, (profit / target) * 100)) : 0;
  return (
    <section className="panel goal-panel">
      <div className="panel-title">
        <div>
          <h2>本月利润目标</h2>
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

function Stats({ items }: { items: Item[] }) {
  const [view, setView] = useState<'overview' | 'month' | 'year' | 'ranking'>('overview');
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
    <section className="panel">
      <div className="period-tabs">
        {(
          [
            ['overview', '总览'],
            ['month', '月报'],
            ['year', '年报'],
            ['ranking', '排行榜'],
          ] as const
        ).map(([key, label]) => (
          <AsyncButton
            key={key}
            className={view === key ? 'selected' : ''}
            onClick={() => setView(key)}
          >
            {label}
          </AsyncButton>
        ))}
      </div>
      {view === 'overview' && (
        <>
          <PeriodStats sold={sold} />
          <Title title="全部交易统计" note={`${sold.length} 笔已售出`} />
          <div className="stat-grid">
            <Card title="销售额" value={money(revenue)} icon={<Wallet />} />
            <Card title="净收益" value={money(total)} icon={<TrendingUp />} />
            <Card
              title="平均单笔净收益"
              value={money(Math.round(averageProfit))}
              icon={<TrendingUp />}
            />
            <Card title="平均售出天数" value={`${averageDays.toFixed(0)} 天`} icon={<Package />} />
          </div>
          <h3>平台收益</h3>
          <div className="platform-summary">
            {platformGroups.map((group) => (
              <div className="category-income-row" key={group.platform}>
                <div className="grow">
                  <b>{group.platform}</b>
                  <small>{group.count} 笔已售出</small>
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
            note={`${reportRows.length} 个周期`}
          />
          <ReportTable rows={reportRows} />
        </>
      )}
      {view === 'ranking' && (
        <div className="ranking-grid">
          <div>
            <h3>利润排行榜</h3>
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
    <div>
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
          title="区间净收益"
          value={money(filtered.reduce((sum, item) => sum + profitCents(item), 0))}
          icon={<TrendingUp />}
        />
      </div>
      <h3>分类收益</h3>
      {groups.map((group) => (
        <div
          className="category-income-row"
          key={group.category}
          style={{ '--category-color': categoryColor(group.category) } as React.CSSProperties}
        >
          <span className="category-income-icon">{group.category[0] ?? '?'}</span>
          <div className="grow">
            <b>{group.category}</b>
            <small>{group.count} 笔已售出</small>
          </div>
          <span className="category-income-label">净收益</span>
          <b className={group.value < 0 ? 'loss' : 'gain'}>{money(group.value)}</b>
        </div>
      ))}
      {!groups.length && <Empty text="该时间段暂无销售数据" />}
    </div>
  );
}

function ReportTable({ rows }: { rows: ReturnType<typeof monthlySummary> }) {
  return (
    <div className="report-table">
      <div className="report-head">
        <b>期间</b>
        <b>售出数量</b>
        <b>销售额</b>
        <b>净收益</b>
        <b>销售净利率</b>
      </div>
      {rows.map((row) => (
        <div className="report-row" key={row.period}>
          <span>{row.period}</span>
          <span>{row.count}</span>
          <span>{money(row.revenueCents)}</span>
          <span className={row.profitCents >= 0 ? 'gain' : 'loss'}>{money(row.profitCents)}</span>
          <span>
            {row.revenueCents ? `${((row.profitCents / row.revenueCents) * 100).toFixed(1)}%` : '—'}
          </span>
        </div>
      ))}
      {!rows.length && <Empty text="暂无可统计的数据" />}
    </div>
  );
}

function RecycleBin({
  items,
  onRestore,
  onPurge,
  pageSize,
}: {
  items: Item[];
  onRestore: (ids: string[]) => void;
  onPurge: (ids?: string[]) => void;
  pageSize: number;
}) {
  const [page, setPage] = useState(1);
  const effectivePageSize = [10, 20, 50].includes(pageSize) ? pageSize : 10;
  const pages = Math.max(1, Math.ceil(items.length / effectivePageSize));
  const safePage = Math.min(page, pages);
  const pagedItems = items.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  return (
    <section className="panel">
      <Title title="回收站" note={`${items.length} 条记录`} />
      {items.length > 0 && (
        <div className="batch-bar">
          <span>删除后仍可恢复</span>
          <AsyncButton className="danger" onClick={() => onPurge()}>
            清空回收站
          </AsyncButton>
        </div>
      )}
      {pagedItems.map((item) => (
        <div className="product" key={item.id}>
          <Thumb item={item} />
          <div className="grow">
            <b>{item.name}</b>
            <small>
              {item.category} ·{' '}
              {item.deletedAt ? new Date(item.deletedAt).toLocaleString('zh-CN') : ''}
            </small>
          </div>
          <AsyncButton className="outline" onClick={() => onRestore([item.id])}>
            恢复
          </AsyncButton>
          <AsyncButton className="danger" onClick={() => onPurge([item.id])}>
            永久删除
          </AsyncButton>
        </div>
      ))}
      {!items.length && <Empty text="回收站为空" />}
      <Pagination
        page={safePage}
        total={items.length}
        pageSize={effectivePageSize}
        onPage={setPage}
      />
    </section>
  );
}

function SettingsPage({
  items,
  backend,
  categories,
  templates,
  inventoryMovements,
  onCategories,
  onTemplates,
  onPreview,
  theme,
  accent,
  onTheme,
  onAccent,
  sidebar,
  onSidebar,
  preferences,
  onPreferences,
  skipRecycleConfirm,
  onRestoreRecycleConfirm,
}: {
  items: Item[];
  backend: StorageBackend;
  categories: string[];
  templates: FeeTemplate[];
  inventoryMovements: InventoryMovement[];
  onCategories: (value: string[]) => Promise<void>;
  onTemplates: (value: FeeTemplate[]) => Promise<void>;
  onPreview: (value: ImportPreview) => void;
  theme: ThemeName;
  accent: string;
  onTheme: (value: ThemeName) => void;
  onAccent: (value: string) => void;
  sidebar: string;
  onSidebar: (value: string) => void;
  preferences: LedgerPreferences;
  onPreferences: (value: LedgerPreferences) => void;
  skipRecycleConfirm: boolean;
  onRestoreRecycleConfirm: () => void;
}) {
  const [newCategory, setNewCategory] = useState('');
  const { notify } = useFeedback();
  const [fee, setFee] = useState({
    name: '',
    platform: '',
    shipping: '0',
    platformFee: '0',
    otherFee: '0',
  });
  async function loadFile(
    event: React.ChangeEvent<HTMLInputElement>,
    kind: 'json' | 'csv' | 'xlsx',
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed =
        kind === 'xlsx'
          ? await parseExcelItems(await file.arrayBuffer())
          : kind === 'csv'
            ? parseCsvItems(await file.text())
            : parseJsonItems(await file.text());
      onPreview(buildImportPreview(kind, kind === 'json' ? 'replace' : 'merge', parsed, items));
    } catch (error) {
      notify(`读取失败：${error instanceof Error ? error.message : '文件格式不正确'}`);
    } finally {
      input.value = '';
    }
  }
  async function openDataDirectory() {
    if (!isTauriRuntime()) {
      notify('浏览器预览模式没有独立数据目录');
      return;
    }
    try {
      await openPath(await appConfigDir());
    } catch {
      notify('无法打开数据目录');
    }
  }
  async function addCategory() {
    const name = newCategory.trim();
    if (!name || categories.includes(name)) return;
    await onCategories([...categories, name]);
    setNewCategory('');
  }
  async function addTemplate() {
    if (!fee.name.trim() || !fee.platform.trim()) {
      notify('请输入模板名称和平台名称');
      return;
    }
    try {
      await onTemplates([
        {
          id: crypto.randomUUID(),
          name: fee.name.trim(),
          platform: fee.platform.trim(),
          shippingCents: yuanToCents(fee.shipping),
          platformFeeCents: yuanToCents(fee.platformFee),
          otherFeeCents: yuanToCents(fee.otherFee),
          createdAt: Date.now(),
        },
        ...templates,
      ]);
      setFee({ name: '', platform: '', shipping: '0', platformFee: '0', otherFee: '0' });
    } catch (error) {
      notify(error instanceof Error ? error.message : '金额不正确');
    }
  }
  return (
    <div className="settings-stack">
      <section className="panel">
        <Title title="外观与颜色" note="主题会保存在本机" />
        <div className="theme-grid">
          {themeNames.map(([key, label]) => (
            <AsyncButton
              key={key}
              className={theme === key ? 'theme-choice selected' : 'theme-choice'}
              onClick={() => onTheme(key)}
            >
              <i className={`theme-swatch ${key}`} />
              {label}
            </AsyncButton>
          ))}
        </div>
        <label className="accent-picker">
          自定义强调色
          <input type="color" value={accent} onChange={(event) => onAccent(event.target.value)} />
        </label>
        <label className="accent-picker">
          侧边栏颜色
          <input type="color" value={sidebar} onChange={(event) => onSidebar(event.target.value)} />
        </label>
        <small className="muted">
          主题会统一按钮、图表、选中状态和焦点颜色；盈利、亏损和危险操作保持固定语义色。
        </small>
      </section>
      <section className="panel settings">
        <h2>本地数据</h2>
        <p>
          当前存储：{backend === 'sqlite' ? 'SQLite 本机数据库' : '浏览器 LocalStorage（Web 预览）'}
          。无需账号或网络。
        </p>
        <div className="backup-actions">
          <AsyncButton
            className="primary"
            onClick={async () => {
              if (
                await saveOutput(
                  `收益账本备份-${dateKey()}.json`,
                  'json',
                  'JSON 备份',
                  exportBackup(await loadBackupItems(), categories, templates, inventoryMovements),
                  'application/json',
                )
              )
                notify('JSON 备份已导出');
            }}
          >
            导出完整备份
          </AsyncButton>
          <AsyncButton
            className="outline"
            onClick={async () => {
              if (
                await saveOutput(
                  `收益账本明细-${dateKey()}.csv`,
                  'csv',
                  'CSV 表格',
                  exportCsv(items.filter((item) => !item.deletedAt)),
                  'text/csv',
                )
              )
                notify('CSV 明细已导出');
            }}
          >
            导出 CSV
          </AsyncButton>
          <AsyncButton
            className="outline"
            onClick={async () => {
              if (
                await saveOutput(
                  `收益账本明细-${dateKey()}.xlsx`,
                  'xlsx',
                  'Excel 工作簿',
                  await exportExcel(items.filter((item) => !item.deletedAt)),
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                )
              )
                notify('Excel 明细已导出');
            }}
          >
            导出 Excel
          </AsyncButton>
          <FileButton
            label="导入 JSON"
            accept=".json,application/json"
            onChange={(e) => loadFile(e, 'json')}
          />
          <FileButton
            label="导入 CSV"
            accept=".csv,text/csv"
            onChange={(e) => loadFile(e, 'csv')}
          />
          <FileButton label="导入 Excel" accept=".xlsx" onChange={(e) => loadFile(e, 'xlsx')} />
          <AsyncButton className="outline" onClick={openDataDirectory}>
            打开数据目录
          </AsyncButton>
        </div>
        <div className="tip">导入前会显示新增、重复、错误和覆盖数量，确认后才写入数据库。</div>
      </section>
      <section className="panel settings">
        <Title title="使用偏好与提醒" note="设置会保存在本机" />
        <div className="three">
          <label>
            每页显示条目
            <select
              value={preferences.pageSize}
              onChange={(event) =>
                onPreferences({
                  ...preferences,
                  pageSize: Number(event.target.value) as LedgerPreferences['pageSize'],
                })
              }
            >
              <option value="10">10 条</option>
              <option value="20">20 条</option>
              <option value="50">50 条</option>
            </select>
          </label>
          <FormInput
            label="滞销提醒天数"
            type="number"
            value={String(preferences.stagnantDays)}
            onChange={(value) =>
              onPreferences({ ...preferences, stagnantDays: Math.max(1, Number(value) || 1) })
            }
          />
          <FormInput
            label="低利润阈值（元）"
            type="number"
            value={centsToYuan(preferences.lowProfitCents)}
            onChange={(value) => {
              try {
                onPreferences({ ...preferences, lowProfitCents: yuanToCents(value || '0') });
              } catch {}
            }}
          />
        </div>
        <small className="muted">
          快捷键：Ctrl + N 添加商品；Esc 关闭弹窗。商品页会记住最后一次保存的筛选条件。
        </small>
      </section>
      <section className="panel settings">
        <Title title="删除确认" note="仅影响移入回收站" />
        <p>
          {skipRecycleConfirm
            ? '当前已关闭“移入回收站”确认提示；永久删除仍会要求确认。'
            : '移入回收站前会显示确认提示；永久删除始终要求确认。'}
        </p>
        {skipRecycleConfirm && (
          <AsyncButton className="outline" onClick={onRestoreRecycleConfirm}>
            恢复移入回收站确认提示
          </AsyncButton>
        )}
      </section>
      <section className="panel">
        <Title title="自定义分类" note={`${categories.length} 个`} />
        <div className="inline-form">
          <input
            value={newCategory}
            placeholder="新分类名称"
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <AsyncButton className="primary" onClick={addCategory}>
            添加
          </AsyncButton>
        </div>
        <div className="chip-list">
          {categories.map((category) => (
            <span
              key={category}
              style={{ '--category-color': categoryColor(category) } as React.CSSProperties}
            >
              {category}
              <AsyncButton
                title="删除分类"
                aria-label={`删除分类：${category}`}
                disabled={items.some((item) => item.category === category)}
                onClick={() => onCategories(categories.filter((x) => x !== category))}
              >
                ×
              </AsyncButton>
            </span>
          ))}
        </div>
        <small className="muted">正在使用的分类不能删除，可先批量修改商品分类。</small>
      </section>
      <section className="panel">
        <Title title="销售平台与费用模板" note={`${templates.length} 个`} />
        <div className="template-form">
          <label>
            模板名称
            <input
              placeholder="例如：闲鱼标准费率"
              value={fee.name}
              onChange={(e) => setFee({ ...fee, name: e.target.value })}
            />
          </label>
          <label>
            平台名称
            <input
              placeholder="例如：闲鱼"
              value={fee.platform}
              onChange={(e) => setFee({ ...fee, platform: e.target.value })}
            />
          </label>
          <label>
            邮费（元）
            <input
              type="number"
              step="0.01"
              placeholder="邮费"
              value={fee.shipping}
              onChange={(e) => setFee({ ...fee, shipping: e.target.value })}
            />
          </label>
          <label>
            平台手续费（元）
            <input
              type="number"
              step="0.01"
              placeholder="平台手续费"
              value={fee.platformFee}
              onChange={(e) => setFee({ ...fee, platformFee: e.target.value })}
            />
          </label>
          <label>
            其他费用（元）
            <input
              type="number"
              step="0.01"
              placeholder="其他费用"
              value={fee.otherFee}
              onChange={(e) => setFee({ ...fee, otherFee: e.target.value })}
            />
          </label>
          <AsyncButton className="primary" onClick={addTemplate}>
            保存模板
          </AsyncButton>
        </div>
        {templates.map((template) => (
          <div className="row" key={template.id}>
            <div className="grow">
              <b>
                {template.name} · {template.platform}
              </b>
              <small>
                邮费 {money(template.shippingCents)} · 手续费 {money(template.platformFeeCents)} ·
                其他 {money(template.otherFeeCents)}
              </small>
            </div>
            <AsyncButton
              className="icon-btn"
              aria-label={`删除费用模板：${template.name}`}
              title="删除费用模板"
              onClick={() => onTemplates(templates.filter((x) => x.id !== template.id))}
            >
              <Trash2 size={16} />
            </AsyncButton>
          </div>
        ))}
      </section>
    </div>
  );
}

function ItemModal({
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
      await onSave(draft);
    } catch (error) {
      notify(error instanceof Error ? error.message : '表单内容不正确');
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form
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
          <FormInput
            label="预计售价（元，可选）"
            type="number"
            value={form.expectedSale}
            onChange={(v) => set('expectedSale', v)}
          />
        </div>
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

function ItemDetailModal({
  item,
  logs,
  movements,
  onClose,
}: {
  item: Item;
  logs: OperationLog[];
  movements: InventoryMovement[];
  onClose: () => void;
}) {
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
      <div className="detail-grid">
        <span>
          分类<b style={{ color: categoryColor(item.category) }}>{item.category}</b>
        </span>
        <span>
          状态<b>{item.status === 'sold' ? '已售出' : '库存中'}</b>
        </span>
        <span>
          购入成本<b>{money(item.purchaseCents)}</b>
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
              <b className={profitCents(item) >= 0 ? 'gain' : 'loss'}>{money(profitCents(item))}</b>
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
      {item.tags.length > 0 && (
        <div className="tag-list">
          {item.tags.map((tag, index) => (
            <span key={`${tag}-${index}`}>{tag}</span>
          ))}
        </div>
      )}
      {item.note && <p className="detail-note">{item.note}</p>}
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

function SellModal({
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
        <AsyncButton className="primary full" type="submit">
          确认售出
        </AsyncButton>
      </form>
    </Modal>
  );
}

function ImportPreviewModal({
  preview,
  onClose,
  onConfirm,
}: {
  preview: ImportPreview;
  onClose: () => void;
  onConfirm: (preview: ImportPreview) => Promise<void>;
}) {
  const [skipSuspected, setSkipSuspected] = useState(false);
  const suspectedIds = new Set(preview.suspected?.map((item) => item.id) ?? []);
  const effective = skipSuspected
    ? {
        ...preview,
        items: preview.items.filter((item) => !suspectedIds.has(item.id)),
        added: preview.added - suspectedIds.size,
        skipped: preview.skipped + suspectedIds.size,
      }
    : preview;
  return (
    <Modal title="导入预览" onClose={onClose}>
      <div className="preview-grid">
        <Card title="将新增" value={`${effective.added} 条`} icon={<Plus />} />
        <Card title="跳过重复" value={`${effective.skipped} 条`} icon={<Package />} />
        <Card title="格式错误" value={`${preview.errors.length} 行`} icon={<Tags />} />
        <Card title="将覆盖" value={`${preview.overwritten} 条`} icon={<Trash2 />} />
      </div>
      {suspectedIds.size > 0 && (
        <div className="warning-box">
          <p>{suspectedIds.size} 条没有记录 ID 的商品疑似重复，默认保留。</p>
          <label>
            <input
              type="checkbox"
              checked={skipSuspected}
              onChange={(e) => setSkipSuspected(e.target.checked)}
            />
            跳过这些疑似重复商品
          </label>
          {preview.suspected?.slice(0, 10).map((item) => (
            <div key={item.id}>
              {item.name} · {item.purchaseDate} · {money(item.purchaseCents)}
            </div>
          ))}
        </div>
      )}
      {preview.backup && (
        <div className="warning-box">
          完整恢复会替换全部商品（含回收站）、{preview.backup.categories.length} 个分类和{' '}
          {preview.backup.templates.length} 个费用模板。
          {preview.backup.version === 1
            ? ' 此旧版备份不含库存流水；确认恢复后，当前库存变动记录会被清除。'
            : ` 将同时恢复 ${preview.backup.inventoryMovements?.length ?? 0} 条库存变动记录。`}
        </div>
      )}
      {!preview.backup && preview.mode === 'replace' && (
        <div className="warning-box">
          JSON 备份将替换当前商品记录，回收站中不同 ID 的记录保留。有格式错误时请先修正文件。
        </div>
      )}
      {preview.errors.length > 0 && (
        <div className="error-list">
          <b>错误明细</b>
          {preview.errors.slice(0, 20).map((error) => (
            <div key={error}>{error}</div>
          ))}
          {preview.errors.length > 20 && (
            <small>另有 {preview.errors.length - 20} 条错误未显示</small>
          )}
        </div>
      )}
      <div className="modal-actions">
        <AsyncButton className="outline" onClick={onClose}>
          取消
        </AsyncButton>
        <AsyncButton
          className="primary"
          disabled={
            (!effective.added && !preview.backup) ||
            (preview.mode === 'replace' && preview.errors.length > 0)
          }
          onClick={() => onConfirm(effective)}
        >
          确认导入
        </AsyncButton>
      </div>
    </Modal>
  );
}

function FormInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function FileButton({
  label,
  accept,
  onChange,
}: {
  label: string;
  accept: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}) {
  const { busy, run } = useAction();
  return (
    <label className="outline file-button">
      {label}
      <input
        type="file"
        accept={accept}
        disabled={busy}
        onChange={(event) => {
          void run(() => onChange(event));
        }}
      />
    </label>
  );
}
function Card({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="card">
      <div>
        <small>{title}</small>
        <b>{value}</b>
      </div>
      <span>{icon}</span>
    </div>
  );
}
function Title({ title, note }: { title: string; note: string }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      <span>{note}</span>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
