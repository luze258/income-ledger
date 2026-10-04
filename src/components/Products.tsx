import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { inventoryDays, money, profitCents, yuanToCents } from '../domain';
import { AsyncButton } from '../actions';
import { useFeedback } from '../feedback';
import type { Item } from '../types';
import { Thumb } from './Thumb';
import { Pagination } from './Pagination';

type SortKey = 'newest' | 'name' | 'purchaseAsc' | 'purchaseDesc' | 'profitDesc' | 'daysDesc';
type SavedFilter = {
  id: string;
  name: string;
  query: string;
  category: string;
  status: string;
  sort: SortKey;
  profitFilter: string;
  platformFilter?: string;
  tagFilter?: string;
  minPrice?: string;
  maxPrice?: string;
  minDays?: string;
  maxDays?: string;
};

export function Products({
  items,
  categories,
  onSell,
  onEdit,
  onDetails,
  onDelete,
  onBatchDelete,
  onBatchCategory,
  onBatchUpdate,
  imageRevisions,
  pageSize,
  stagnantDays,
  jump,
}: {
  items: Item[];
  categories: string[];
  onSell: (item: Item) => void;
  onEdit: (item: Item) => void;
  onDetails: (item: Item) => void;
  onDelete: (id: string) => void;
  onBatchDelete: (ids: string[]) => Promise<void>;
  onBatchCategory: (ids: string[], category: string) => Promise<void>;
  onBatchUpdate: (ids: string[], changes: Partial<Item>) => Promise<void>;
  imageRevisions: Record<string, number>;
  pageSize: number;
  stagnantDays: number;
  jump?: 'stagnant' | 'lowProfit' | 'stock' | null;
}) {
  const { confirm } = useFeedback();
  const effectivePageSize = [10, 20, 50].includes(pageSize) ? pageSize : 10;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部分类');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [date, setDate] = useState('');
  const [profitFilter, setProfitFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minDays, setMinDays] = useState('');
  const [maxDays, setMaxDays] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchCategory, setBatchCategory] = useState(categories[0] ?? '');
  const [batchPlatform, setBatchPlatform] = useState('');
  const [batchTags, setBatchTags] = useState('');
  const [batchExpectedSale, setBatchExpectedSale] = useState('');
  const [clearPlatform, setClearPlatform] = useState(false);
  const [clearTags, setClearTags] = useState(false);
  const [clearExpectedSale, setClearExpectedSale] = useState(false);
  const [page, setPage] = useState(1);
  const [savedViews, setSavedViews] = useState<SavedFilter[]>(() => {
    try {
      const many = JSON.parse(
        localStorage.getItem('income-ledger-saved-filters') || '[]',
      ) as SavedFilter[];
      if (many.length) return many;
      const legacy = JSON.parse(
        localStorage.getItem('income-ledger-saved-filter') || 'null',
      ) as Omit<SavedFilter, 'id' | 'name'> | null;
      return legacy ? [{ ...legacy, id: 'legacy', name: '已保存筛选' }] : [];
    } catch {
      return [];
    }
  });
  const normalizedQuery = useDeferredValue(query).trim().toLocaleLowerCase('zh-CN');
  const list = useMemo(
    () =>
      items
        .filter(
          (item) =>
            `${item.name} ${item.note ?? ''} ${item.tags.join(' ')}`
              .toLocaleLowerCase('zh-CN')
              .includes(normalizedQuery) &&
            (category === '全部分类' || item.category === category) &&
            (status === 'all' || item.status === status) &&
            (!platformFilter || item.platform === platformFilter) &&
            (!tagFilter ||
              item.tags.some((tag) =>
                tag.toLocaleLowerCase('zh-CN').includes(tagFilter.toLocaleLowerCase('zh-CN')),
              )) &&
            (!minPrice || item.purchaseCents >= yuanToCents(minPrice)) &&
            (!maxPrice || item.purchaseCents <= yuanToCents(maxPrice)) &&
            (!minDays || inventoryDays(item) >= Number(minDays)) &&
            (!maxDays || inventoryDays(item) <= Number(maxDays)) &&
            (!date || item.purchaseDate === date || item.saleDate === date) &&
            (profitFilter === 'all' ||
              (item.status === 'sold' &&
                (profitFilter === 'profit' ? profitCents(item) > 0 : profitCents(item) < 0))),
        )
        .sort((left, right) => {
          if (sort === 'name') return left.name.localeCompare(right.name, 'zh-CN');
          if (sort === 'purchaseAsc') return left.purchaseCents - right.purchaseCents;
          if (sort === 'purchaseDesc') return right.purchaseCents - left.purchaseCents;
          if (sort === 'profitDesc') return profitCents(right) - profitCents(left);
          if (sort === 'daysDesc') return inventoryDays(right) - inventoryDays(left);
          return right.createdAt - left.createdAt;
        }),
    [
      items,
      normalizedQuery,
      category,
      status,
      sort,
      date,
      profitFilter,
      platformFilter,
      tagFilter,
      minPrice,
      maxPrice,
      minDays,
      maxDays,
    ],
  );
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  useEffect(
    () =>
      setSelected(
        (current) => new Set([...current].filter((id) => items.some((item) => item.id === id))),
      ),
    [items],
  );
  useEffect(
    () => setPage(1),
    [
      normalizedQuery,
      category,
      status,
      sort,
      date,
      profitFilter,
      platformFilter,
      tagFilter,
      minPrice,
      maxPrice,
      minDays,
      maxDays,
    ],
  );
  useEffect(() => {
    if (!jump) return;
    setStatus(jump === 'lowProfit' ? 'sold' : 'in_stock');
    if (jump === 'stagnant') setMinDays(String(stagnantDays));
    if (jump === 'lowProfit') setProfitFilter('loss');
  }, [jump, stagnantDays]);
  const pages = Math.max(1, Math.ceil(list.length / effectivePageSize));
  const safePage = Math.min(page, pages);
  const pagedList = list.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);
  const platforms = [...new Set(items.map((item) => item.platform).filter(Boolean))] as string[];
  const savedFilterLabel =
    [
      category !== '全部分类' ? category : '',
      status === 'in_stock' ? '库存中' : status === 'sold' ? '已售出' : '',
      profitFilter === 'profit' ? '盈利' : profitFilter === 'loss' ? '亏损' : '',
      platformFilter,
    ]
      .filter(Boolean)
      .join(' · ') || '已保存筛选';
  const allFilteredSelected = list.length > 0 && list.every((item) => selected.has(item.id));
  const advancedCount = [platformFilter, tagFilter, minPrice, maxPrice, minDays, maxDays].filter(
    Boolean,
  ).length;

  const clearFilters = () => {
    setQuery('');
    setCategory('全部分类');
    setStatus('all');
    setSort('newest');
    setDate('');
    setProfitFilter('all');
    setPlatformFilter('');
    setTagFilter('');
    setMinPrice('');
    setMaxPrice('');
    setMinDays('');
    setMaxDays('');
  };
  const clearAdvancedFilters = () => {
    setPlatformFilter('');
    setTagFilter('');
    setMinPrice('');
    setMaxPrice('');
    setMinDays('');
    setMaxDays('');
  };

  return (
    <section className="panel">
      <div className="filter-toolbar-wrap">
        <div className="filter-toolbar">
          <div className="search">
            <Search size={17} />
            <input
              placeholder="搜索名称、备注或标签"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option>全部分类</option>
            {categories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">全部状态</option>
            <option value="in_stock">库存中</option>
            <option value="sold">已售出</option>
          </select>
          <select
            aria-label="盈亏筛选"
            value={profitFilter}
            onChange={(event) => setProfitFilter(event.target.value)}
          >
            <option value="all">全部盈亏</option>
            <option value="profit">盈利</option>
            <option value="loss">亏损</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="newest">最新添加</option>
            <option value="name">名称排序</option>
            <option value="purchaseAsc">购入价从低到高</option>
            <option value="purchaseDesc">购入价从高到低</option>
            <option value="profitDesc">利润从高到低</option>
            <option value="daysDesc">库存天数从高到低</option>
          </select>
          <input
            className="date-filter"
            aria-label="交易日期筛选"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      </div>
      <div className="advanced-filter-toggle">
        <AsyncButton className="outline" onClick={() => setAdvancedOpen((value) => !value)}>
          {advancedOpen ? '收起高级筛选' : `高级筛选${advancedCount ? `（${advancedCount}）` : ''}`}
        </AsyncButton>
        {advancedCount > 0 && (
          <AsyncButton
            className="icon-btn"
            title="清空高级筛选"
            aria-label="清空高级筛选"
            onClick={clearAdvancedFilters}
          >
            清空高级条件
          </AsyncButton>
        )}
      </div>
      {advancedOpen && (
        <div className="advanced-filter-panel">
          <label>
            平台
            <select
              value={platformFilter}
              onChange={(event) => setPlatformFilter(event.target.value)}
            >
              <option value="">全部平台</option>
              {platforms.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            标签
            <input
              aria-label="标签筛选"
              placeholder="标签包含"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
            />
          </label>
          <label>
            购入价区间（元）
            <span className="range-inputs">
              <input
                aria-label="最低购入价"
                type="number"
                min="0"
                step="0.01"
                placeholder="最低"
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value)}
              />
              <b>–</b>
              <input
                aria-label="最高购入价"
                type="number"
                min="0"
                step="0.01"
                placeholder="最高"
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
              />
            </span>
          </label>
          <label>
            库存天数区间
            <span className="range-inputs">
              <input
                aria-label="最短库存天数"
                type="number"
                min="0"
                placeholder="最短"
                value={minDays}
                onChange={(event) => setMinDays(event.target.value)}
              />
              <b>–</b>
              <input
                aria-label="最长库存天数"
                type="number"
                min="0"
                placeholder="最长"
                value={maxDays}
                onChange={(event) => setMaxDays(event.target.value)}
              />
            </span>
          </label>
        </div>
      )}
      <div className="filter-actions">
        <div className="quick-views">
          <AsyncButton
            className="outline"
            onClick={() => {
              setStatus('in_stock');
              setSort('newest');
            }}
          >
            待售库存
          </AsyncButton>
          <AsyncButton
            className="outline"
            onClick={() => {
              setStatus('sold');
              setProfitFilter('profit');
              setSort('profitDesc');
            }}
          >
            高利润
          </AsyncButton>
          <AsyncButton
            className="outline"
            onClick={() => {
              setStatus('in_stock');
              setSort('daysDesc');
            }}
          >
            滞销库存
          </AsyncButton>
        </div>
        <div className="saved-filter-actions">
          <AsyncButton
            className="outline"
            onClick={() => {
              const name = savedFilterLabel;
              const next: SavedFilter = {
                id: crypto.randomUUID(),
                name,
                query,
                category,
                status,
                sort,
                profitFilter,
                platformFilter,
                tagFilter,
                minPrice,
                maxPrice,
                minDays,
                maxDays,
              };
              setSavedViews((current) => {
                const updated = [...current.filter((value) => value.name !== name), next];
                localStorage.setItem('income-ledger-saved-filters', JSON.stringify(updated));
                return updated;
              });
            }}
          >
            保存当前筛选
          </AsyncButton>
          {savedViews.map((savedView) => (
            <span className="saved-filter" key={savedView.id}>
              <AsyncButton
                className="outline"
                onClick={() => {
                  setQuery(savedView.query);
                  setCategory(savedView.category);
                  setStatus(savedView.status);
                  setSort(savedView.sort);
                  setProfitFilter(savedView.profitFilter);
                  setPlatformFilter(savedView.platformFilter ?? '');
                  setTagFilter(savedView.tagFilter ?? '');
                  setMinPrice(savedView.minPrice ?? '');
                  setMaxPrice(savedView.maxPrice ?? '');
                  setMinDays(savedView.minDays ?? '');
                  setMaxDays(savedView.maxDays ?? '');
                }}
              >
                {savedView.name}
              </AsyncButton>
              <AsyncButton
                className="icon-btn"
                aria-label={`删除筛选：${savedView.name}`}
                onClick={() =>
                  setSavedViews((current) => {
                    const updated = current.filter((value) => value.id !== savedView.id);
                    localStorage.setItem('income-ledger-saved-filters', JSON.stringify(updated));
                    return updated;
                  })
                }
              >
                ×
              </AsyncButton>
            </span>
          ))}
          <AsyncButton
            className="outline"
            disabled={!list.length}
            onClick={() =>
              setSelected((current) => {
                const next = new Set(current);
                if (allFilteredSelected) list.forEach((item) => next.delete(item.id));
                else list.forEach((item) => next.add(item.id));
                return next;
              })
            }
          >
            {allFilteredSelected ? '反选筛选结果' : '全选筛选结果'}
          </AsyncButton>
          <AsyncButton className="outline" onClick={clearFilters}>
            清空筛选
          </AsyncButton>
          <span className="filter-count">{list.length} 件商品</span>
        </div>
      </div>
      {selected.size > 0 && (
        <div className="batch-bar">
          <b>已选 {selected.size} 件</b>
          <select value={batchCategory} onChange={(event) => setBatchCategory(event.target.value)}>
            {categories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <AsyncButton
            className="outline"
            onClick={async () => {
              await onBatchCategory([...selected], batchCategory);
              setSelected(new Set());
            }}
          >
            批量修改分类
          </AsyncButton>
          <input
            aria-label="批量销售平台"
            placeholder="设置销售平台"
            value={batchPlatform}
            onChange={(event) => setBatchPlatform(event.target.value)}
          />
          <input
            aria-label="批量标签"
            placeholder="覆盖标签（逗号分隔）"
            value={batchTags}
            onChange={(event) => setBatchTags(event.target.value)}
          />
          <input
            aria-label="批量预计售价"
            type="number"
            min="0"
            step="0.01"
            placeholder="预计售价（元）"
            value={batchExpectedSale}
            onChange={(event) => setBatchExpectedSale(event.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={clearPlatform}
              onChange={(event) => setClearPlatform(event.target.checked)}
            />{' '}
            清空平台
          </label>
          <label>
            <input
              type="checkbox"
              checked={clearTags}
              onChange={(event) => setClearTags(event.target.checked)}
            />{' '}
            清空标签
          </label>
          <label>
            <input
              type="checkbox"
              checked={clearExpectedSale}
              onChange={(event) => setClearExpectedSale(event.target.checked)}
            />{' '}
            清空预计售价
          </label>
          <AsyncButton
            className="outline"
            onClick={async () => {
              const changes: Partial<Item> = {};
              if (batchPlatform.trim()) changes.platform = batchPlatform.trim();
              else if (clearPlatform) changes.platform = undefined;
              if (batchTags.trim())
                changes.tags = batchTags
                  .split(/[,，]/)
                  .map((tag) => tag.trim())
                  .filter(Boolean);
              else if (clearTags) changes.tags = [];
              if (batchExpectedSale) changes.expectedSaleCents = yuanToCents(batchExpectedSale);
              else if (clearExpectedSale) changes.expectedSaleCents = undefined;
              if (!Object.keys(changes).length) return;
              if (
                !(await confirm(`将更新 ${selected.size} 条商品；未填写的字段不会修改。是否继续？`))
              )
                return;
              await onBatchUpdate([...selected], changes);
              setSelected(new Set());
            }}
          >
            批量更新字段
          </AsyncButton>
          <AsyncButton
            className="danger"
            onClick={async () => {
              await onBatchDelete([...selected]);
              setSelected(new Set());
            }}
          >
            批量移入回收站
          </AsyncButton>
        </div>
      )}
      {pagedList.map((item) => (
        <div className="product" key={item.id}>
          <input
            className="row-check"
            type="checkbox"
            checked={selected.has(item.id)}
            aria-label={`选择商品：${item.name}`}
            onChange={() => toggle(item.id)}
          />
          <Thumb item={item} revision={imageRevisions[item.id]} />
          <div className="grow">
            <b>{item.name}</b>
            <small>
              {item.category} · 购入 {money(item.purchaseCents)} · 数量 {item.quantity ?? 1} ·{' '}
              {item.purchaseDate}
              {item.expectedSaleCents != null ? ` · 预计售价 ${money(item.expectedSaleCents)}` : ''}
              {item.status === 'in_stock' ? ` · 库存 ${inventoryDays(item)} 天` : ''}
            </small>
            {item.tags.length > 0 && (
              <div className="tag-list">
                {item.tags.map((tag, index) => (
                  <span key={`${tag}-${index}`}>{tag}</span>
                ))}
              </div>
            )}
          </div>
          {item.status === 'sold' ? (
            <span className={profitCents(item) >= 0 ? 'gain result' : 'loss result'}>
              {profitCents(item) >= 0 ? '+' : ''}
              {money(profitCents(item))}
            </span>
          ) : (
            <AsyncButton className="outline" onClick={() => onSell(item)}>
              售出
            </AsyncButton>
          )}
          <AsyncButton className="outline" onClick={() => onEdit(item)}>
            编辑
          </AsyncButton>
          <AsyncButton
            className="icon-btn"
            title="查看详情"
            aria-label={`查看商品详情：${item.name}`}
            onClick={() => onDetails(item)}
          >
            i
          </AsyncButton>
          <AsyncButton
            className="icon-btn"
            title="移入回收站"
            aria-label={`将${item.name}移入回收站`}
            onClick={() => onDelete(item.id)}
          >
            <Trash2 size={16} />
          </AsyncButton>
        </div>
      ))}
      {!list.length && <div className="empty">没有匹配的商品</div>}
      <Pagination
        page={safePage}
        total={list.length}
        pageSize={effectivePageSize}
        onPage={setPage}
      />
    </section>
  );
}
