import React, { useEffect, useState } from 'react';

import { appConfigDir } from '@tauri-apps/api/path';

import { openPath } from '@tauri-apps/plugin-opener';
import { Trash2 } from 'lucide-react';
import { buildImportPreview, centsToYuan, dateKey, money, yuanToCents } from '../domain';
import {
  exportBackup,
  exportCsv,
  exportExcel,
  parseCsvItems,
  parseExcelItems,
  parseJsonItems,
} from '../importExport';
import { isTauriRuntime, loadBackupItems, type StorageBackend } from '../storage';
import type { FeeTemplate, ImportPreview, InventoryMovement, Item, FinanceState } from '../types';
import { AsyncButton } from '../actions';

import { useFeedback } from '../feedback';
import { type LedgerPreferences } from '../preferences';

import {
  Title,
  FormInput,
  FileButton,
  categoryColor,
  themeNames,
  type ThemeName,
} from '../components/Shared';

import { saveOutput } from '../exportFile';
export function SettingsPage({
  onDraftChange,
  section,
  items,
  backend,
  categories,
  templates,
  inventoryMovements,
  finance,
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
  onDraftChange: (dirty: boolean) => void;
  section: 'appearance' | 'data' | 'catalog';
  items: Item[];
  backend: StorageBackend;
  categories: string[];
  templates: FeeTemplate[];
  inventoryMovements: InventoryMovement[];
  finance: FinanceState;
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
  useEffect(() => {
    onDraftChange(
      Boolean(
        newCategory ||
        fee.name ||
        fee.platform ||
        fee.shipping !== '0' ||
        fee.platformFee !== '0' ||
        fee.otherFee !== '0',
      ),
    );
  }, [newCategory, fee, onDraftChange]);
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
    <div className={`settings-stack region-settings settings-${section}`}>
      {section === 'appearance' && (
        <>
          <section className="panel">
            <Title title="外观与颜色" note="应用蓝白配色会同步强调色与白色侧栏；之后仍可自定义" />
            <div className="theme-grid">
              {themeNames.map(([key, label]) => (
                <AsyncButton
                  key={key}
                  className={theme === key ? 'theme-choice selected' : 'theme-choice'}
                  onClick={() => {
                    onTheme(key);
                    if (key === 'blue') {
                      onAccent('#245EA8');
                      onSidebar('#FFFFFF');
                    }
                  }}
                >
                  <i className={`theme-swatch ${key}`} />
                  {label}
                </AsyncButton>
              ))}
            </div>
            <label className="accent-picker">
              自定义强调色
              <input
                type="color"
                value={accent}
                onChange={(event) => onAccent(event.target.value)}
              />
            </label>
            <label className="accent-picker">
              侧边栏颜色
              <input
                type="color"
                value={sidebar}
                onChange={(event) => onSidebar(event.target.value)}
              />
            </label>
            <small className="muted">
              主题会统一按钮、图表、选中状态和焦点颜色；盈利、亏损和危险操作保持固定语义色。
            </small>
          </section>
        </>
      )}
      {section === 'data' && (
        <section className="panel settings">
          <div className="region-heading">
            <h2>本地数据与备份</h2>
            <p>先导出备份；导入会先展示预览，确认后才写入。</p>
          </div>
          <p>
            当前存储：
            {backend === 'sqlite' ? 'SQLite 本机数据库' : '浏览器 LocalStorage（Web 预览）'}
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
                    exportBackup(
                      await loadBackupItems(),
                      categories,
                      templates,
                      inventoryMovements,
                      finance,
                    ),
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
      )}
      {section === 'appearance' && (
        <>
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
        </>
      )}
      {section === 'catalog' && (
        <>
          <section className="panel settings-categories">
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
          <section className="panel settings-templates">
            <Title title="销售平台与费用模板" note={`${templates.length} 条`} />
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
                    邮费 {money(template.shippingCents)} · 手续费 {money(template.platformFeeCents)}{' '}
                    · 其他 {money(template.otherFeeCents)}
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
        </>
      )}
    </div>
  );
}
