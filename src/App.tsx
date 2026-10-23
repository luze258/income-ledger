import { Card, type ThemeName, type OperationLog } from './components/Shared';
import { ItemModal, ItemDetailModal, SellModal } from './pages/ItemDialogs';
import { SettingsPage } from './pages/SettingsPage';
import { RecycleBin } from './pages/RecycleBinPage';
import { ProfitGoal, Stats } from './pages/StatsPage';
import { InventoryPage } from './pages/InventoryPage';
import { Dashboard } from './pages/DashboardPage';
import { Sidebar } from './components/Sidebar';
import { resolvePage, navigationGroups, type Page } from './navigation';
import { FinancePanel } from './components/FinancePanel';
import { defaultFinance, financeSummary, validateFinanceReferences } from './finance';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';

import { Package, Plus, Tags, Trash2 } from 'lucide-react';
import { dateKey, money } from './domain';

import {
  restoreBackup,
  loadFinance,
  saveFinance,
  changeItemCategories,
  initializeStorage,
  isTauriRuntime,
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
import type {
  FeeTemplate,
  ImportPreview,
  InventoryMovement,
  Item,
  ItemWrite,
  FinanceState,
} from './types';
import { AsyncButton, ActionProvider } from './actions';
import { Modal } from './components/Modal';

import { Products, type ProductJump } from './components/Products';

import { FeedbackProvider, useFeedback } from './feedback';
import { loadPreferences, savePreferences, type LedgerPreferences } from './preferences';

import packageJson from '../package.json';

type UndoAction = { label: string; undo: () => Promise<void> };
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
  const [finance, setFinance] = useState<FinanceState>(defaultFinance);
  const [savedCategories, setCategories] = useState<string[]>([]);
  const categories = [...new Set([...savedCategories, ...items.map((item) => item.category)])];
  const [templates, setTemplates] = useState<FeeTemplate[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [backend, setBackend] = useState<StorageBackend>('localStorage');
  const [appVersion, setAppVersion] = useState(packageJson.version);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [preferences, setPreferences] = useState<LedgerPreferences>(loadPreferences);
  const [tab, setTab] = useState<Page>(() => resolvePage(loadPreferences().lastTab));
  const scrollPositions = useRef<Partial<Record<Page, number>>>({});
  const [afterFilter, setAfterFilter] = useState<'all' | 'waiting'>('all');
  const [catalogDirty, setCatalogDirty] = useState(false);
  const navigate = async (page: Page) => {
    if (page === tab) return;
    if (
      tab === '分类与费用模板' &&
      catalogDirty &&
      !(await confirm('分类或费用模板尚未保存。离开后草稿会保留在本次会话中，是否继续？'))
    )
      return;
    scrollPositions.current[tab] = window.scrollY;
    setTab(page);
  };
  useLayoutEffect(() => {
    window.scrollTo(0, scrollPositions.current[tab] ?? 0);
  }, [tab]);
  const [receiptTarget, setReceiptTarget] = useState<Item | null>(null);
  const [financeFilter, setFinanceFilter] = useState<
    'pending' | 'received' | 'unreconciled' | 'historical'
  >('pending');
  const openReceipts = (filter: typeof financeFilter) => {
    setFinanceFilter(filter);
    navigate('回款管理');
  };

  const [productJump, setProductJump] = useState<{ kind: ProductJump } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [sellItem, setSellItem] = useState<Item | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [imageRevisions, setImageRevisions] = useState<Record<string, number>>({});
  const [newAppearance] = useState(() =>
    ['theme', 'accent', 'sidebar'].every(
      (key) => localStorage.getItem(`income-ledger-${key}`) === null,
    ),
  );
  const [theme, setTheme] = useState<ThemeName>(
    () =>
      (localStorage.getItem('income-ledger-theme') as ThemeName) ||
      (newAppearance ? 'blue' : 'system'),
  );
  const [accent, setAccent] = useState(
    () => localStorage.getItem('income-ledger-accent') || (newAppearance ? '#245EA8' : '#397049'),
  );
  const [sidebar, setSidebar] = useState(
    () => localStorage.getItem('income-ledger-sidebar') || (newAppearance ? '#FFFFFF' : '#18352a'),
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
    void getVersion()
      .then(setAppVersion)
      .catch(() => undefined);
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
      .then(async (result) => {
        setFinance(await loadFinance());
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

  async function upsert(item: ItemWrite, action = '更新商品', undoPrevious?: Item) {
    const previous = items.find((i) => i.id === item.id);
    if (
      previous &&
      finance.afterSales.some((a) => a.itemId === item.id) &&
      (previous.purchaseCents !== item.purchaseCents ||
        previous.quantity !== item.quantity ||
        previous.saleCents !== item.saleCents ||
        previous.purchaseDate !== item.purchaseDate ||
        previous.saleDate !== item.saleDate)
    )
      throw new Error('已有售后记录的原交易金额、数量和日期不能修改，请保留原交易');
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
      finance.afterSales.some(
        (a) => ids.includes(a.itemId) || (a.returnedItemId && ids.includes(a.returnedItemId)),
      )
    )
      throw new Error('关联售后的交易和退回库存须保留，请使用报损记录处理库存');
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
    if (finance.afterSales.some((a) => a.kind === 'write_off' && ids.includes(a.itemId)))
      throw new Error('报损库存不能从回收站恢复，请通过新增商品记录重新入库');
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
    const targets = ids ?? trash.map((i) => i.id);
    if (
      finance.afterSales.some(
        (a) =>
          targets.includes(a.itemId) || (a.returnedItemId && targets.includes(a.returnedItemId)),
      )
    )
      throw new Error('售后关联记录须保留，不能永久删除');
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
      setFinance(importPreview.backup.finance ?? defaultFinance());
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

  const onFinance = async (next: FinanceState, updates: Item[] = []) => {
    validateFinanceReferences(next, [
      ...items.filter((i) => !updates.some((u) => u.id === i.id)),
      ...updates,
    ]);
    await saveFinance(next, updates);
    setFinance(next);
    setItems((current) => {
      const changed = new Map(updates.map((i) => [i.id, i]));
      return [
        ...updates.filter((i) => !current.some((old) => old.id === i.id)),
        ...current.map((i) => changed.get(i.id) ?? i),
      ];
    });
    setUndoAction(null);
  };
  if (loadError)
    return (
      <main className="startup-screen" data-theme={theme}>
        <section className="startup-card" aria-labelledby="startup-title">
          <div role="alert">
            <h1 id="startup-title">账本打开失败</h1>
            <p>已停止业务操作，原有数据未自动清理或重置。</p>
          </div>
          <p>请先检查存储权限或数据内容，修复后重新打开账本。</p>
          <details className="startup-details">
            <summary>查看错误详情</summary>
            <pre>{loadError}</pre>
          </details>
          <button className="primary" onClick={() => window.location.reload()}>
            重新打开账本
          </button>
        </section>
      </main>
    );
  if (!ready)
    return (
      <main className="startup-screen" data-theme={theme}>
        <section className="startup-card" role="status" aria-live="polite">
          <div className="startup-progress" aria-hidden="true" />
          <h1>正在打开收益账本…</h1>
          <p>正在读取本机记录，请稍候。</p>
        </section>
      </main>
    );
  return (
    <div
      className="app ledger-app"
      data-theme={theme}
      style={
        {
          '--accent': accent,
          '--sidebar': sidebar,
          '--sidebar-ink': sidebarForeground(sidebar),
          '--sidebar-muted': sidebarForeground(sidebar),
          '--button-ink': sidebarForeground(accent),
          '--custom-accent-ink': sidebarForeground(accent) === '#202A38' ? '#202A38' : accent,
        } as React.CSSProperties
      }
    >
      <Sidebar
        page={tab}
        onNavigate={(page) => {
          if (page === '售后记录') setAfterFilter('all');
          void navigate(page);
        }}
        version={appVersion}
        trashCount={trash.length}
        desktop={backend === 'sqlite'}
      />
      <main>
        <header>
          <div>
            <small className="breadcrumb">
              {navigationGroups.find((group) => group.pages.some((page) => page === tab))?.label ??
                '收益账本'}
            </small>
            <h1>{tab === '首页' ? '经营总览' : tab}</h1>
            {tab === '首页' && (
              <p>{`${dateKey().slice(0, 7).replace('-', '年')}月 · 截至 ${dateKey()} · 收益按各自日期口径`}</p>
            )}
          </div>
          <div className="phase2-header-actions">
            {tab === '首页' && (
              <>
                <AsyncButton
                  className="outline"
                  onClick={() => {
                    setProductJump({ kind: 'stock' });
                    navigate('商品列表');
                  }}
                >
                  登记售出
                </AsyncButton>
                <AsyncButton className="outline" onClick={() => openReceipts('pending')}>
                  登记回款
                </AsyncButton>
              </>
            )}
            {['首页', '商品列表', '当前库存'].includes(tab) && (
              <AsyncButton className="primary" onClick={() => setAddOpen(true)}>
                <Plus size={18} />
                添加商品
              </AsyncButton>
            )}
          </div>
        </header>
        {tab === '首页' && (
          <Dashboard
            items={items}
            onDetails={setDetailItem}
            onSell={setSellItem}
            onReceipt={(item) => {
              setReceiptTarget(item);
              openReceipts(
                item.paymentStatus === 'received'
                  ? 'received'
                  : item.paymentStatus === 'pending'
                    ? 'pending'
                    : 'historical',
              );
            }}
            finance={finance}
            onOpenAfterSales={() => {
              setAfterFilter('waiting');
              navigate('售后记录');
            }}
            onOpenReceipts={openReceipts}
            onNavigate={navigate}
            preferences={preferences}
            onOpenProducts={(jump) => {
              setProductJump({ kind: jump });
              navigate('商品列表');
            }}
          />
        )}
        <div hidden={tab !== '商品列表'}>
          <Products
            finance={finance}
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
            lowProfitCents={preferences.lowProfitCents}
            onReceipt={(item) => {
              setReceiptTarget(item);
              openReceipts(
                item.paymentStatus === 'received'
                  ? 'received'
                  : item.paymentStatus === 'pending'
                    ? 'pending'
                    : 'historical',
              );
            }}
          />
        </div>
        {(tab === '当前库存' || tab === '库存变动记录') && (
          <InventoryPage
            historyOnly={tab === '库存变动记录'}
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
              setProductJump({ kind: 'stock' });
              navigate('商品列表');
            }}
          />
        )}
        {(['收益概览', '月度报表', '年度报表', '排行榜'] as Page[]).includes(tab) && (
          <>
            {tab === '收益概览' && (
              <ProfitGoal profit={financeSummary(items, finance).receivedProfit} />
            )}
            <Stats
              items={active}
              view={
                tab === '月度报表'
                  ? 'month'
                  : tab === '年度报表'
                    ? 'year'
                    : tab === '排行榜'
                      ? 'ranking'
                      : 'overview'
              }
            />
          </>
        )}
        {['资金概览', '回款管理', '售后记录'].includes(tab) && (
          <FinancePanel
            items={items}
            finance={finance}
            onSave={onFinance}
            view={tab === '资金概览' ? 'overview' : tab === '回款管理' ? 'receipts' : 'afterSales'}
            initialAfterFilter={afterFilter}
            filter={financeFilter}
            onFilter={setFinanceFilter}
            pageSize={preferences.pageSize}
            receiptTarget={receiptTarget}
            onReceiptHandled={() => setReceiptTarget(null)}
            onOpenReceipts={openReceipts}
            onOpenInventory={() => {
              setProductJump({ kind: 'occupied' });
              navigate('商品列表');
            }}
          />
        )}
        {tab === '回收站' && (
          <RecycleBin
            items={trash}
            onRestore={restore}
            onPurge={purge}
            pageSize={preferences.pageSize}
          />
        )}
        <div hidden={!['外观与使用偏好', '数据备份与导入', '分类与费用模板'].includes(tab)}>
          <SettingsPage
            onDraftChange={setCatalogDirty}
            section={
              tab === '分类与费用模板'
                ? 'catalog'
                : tab === '数据备份与导入'
                  ? 'data'
                  : 'appearance'
            }
            items={items}
            backend={backend}
            categories={categories}
            templates={templates}
            inventoryMovements={inventoryMovements}
            finance={finance}
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
        </div>
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
          finance={finance}
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

// Appearance only: choose a readable foreground for the user's saved sidebar color.
function sidebarForeground(color: string) {
  const hex = color.slice(1);
  const channels = (hex.length === 3 ? [...hex].map((char) => char + char).join('') : hex)
    .match(/.{2}/g)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? '#202A38' : '#FFFFFF';
}
