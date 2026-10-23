import { useEffect, useState } from 'react';

import type { Item } from '../types';
import { AsyncButton } from '../actions';

import { Thumb } from '../components/Thumb';

import { Pagination } from '../components/Pagination';

import { Title, Empty } from '../components/Shared';

export function RecycleBin({
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
    <section className="panel region-recycle">
      <Title title="回收站" note={`${items.length} 条记录`} />
      {items.length > 0 && (
        <div className="batch-bar">
          <span>当前记录可恢复；永久删除后无法恢复</span>
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
