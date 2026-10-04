import { AsyncButton } from '../actions';

export const PAGE_SIZE = 10;

export function Pagination({
  page,
  total,
  pageSize = PAGE_SIZE,
  onPage,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onPage: (page: number) => void;
}) {
  const effectivePageSize = [10, 20, 50].includes(pageSize) ? pageSize : PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / effectivePageSize));
  if (total <= effectivePageSize) return null;
  const start = (page - 1) * effectivePageSize + 1;
  const end = Math.min(total, page * effectivePageSize);
  const visiblePages = Array.from({ length: pages }, (_, index) => index + 1).filter(
    (value) => value === 1 || value === pages || Math.abs(value - page) <= 1,
  );
  return (
    <nav className="pagination" aria-label="分页导航">
      <span>
        显示 {start}–{end} / 共 {total} 条
      </span>
      <div>
        <AsyncButton className="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          上一页
        </AsyncButton>
        {visiblePages.map((value, index) => (
          <span className="page-group" key={value}>
            {index > 0 && visiblePages[index - 1] !== value - 1 && <i>…</i>}
            <AsyncButton
              className={value === page ? 'page-current' : 'outline'}
              aria-label={`第 ${value} 页`}
              onClick={() => onPage(value)}
            >
              {value}
            </AsyncButton>
          </span>
        ))}
        <AsyncButton className="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          下一页
        </AsyncButton>
      </div>
    </nav>
  );
}
