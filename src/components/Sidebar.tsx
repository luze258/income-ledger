import { useState } from 'react';
import {
  Boxes,
  ChartNoAxesCombined,
  ChevronDown,
  LayoutDashboard,
  Menu,
  Package,
  Settings,
  Trash2,
  Wallet,
} from 'lucide-react';
import { AsyncButton } from '../actions';
import { navigationGroups, type Page } from '../navigation';

const groupIcons = {
  商品管理: Package,
  库存管理: Boxes,
  回款与资金: Wallet,
  统计分析: ChartNoAxesCombined,
  设置: Settings,
};

export function Sidebar({
  page,
  onNavigate,
  version,
  trashCount,
  desktop,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  version: string;
  trashCount: number;
  desktop: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={open ? 'sidebar menu-open' : 'sidebar'}>
      <div className="brand">
        <div className="logo">¥</div>
        <div>
          <b>收益账本</b>
          <small>桌面版 v{version}</small>
        </div>
        <AsyncButton
          className="mobile-menu"
          aria-label="切换导航菜单"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Menu size={20} />
        </AsyncButton>
      </div>
      <nav aria-label="主导航">
        <AsyncButton
          className={page === '首页' ? 'active' : ''}
          aria-current={page === '首页' ? 'page' : undefined}
          onClick={() => {
            onNavigate('首页');
            setOpen(false);
          }}
        >
          <LayoutDashboard size={20} aria-hidden="true" />
          首页
        </AsyncButton>
        {navigationGroups.map((group) => {
          const Icon = groupIcons[group.label];
          return (
            <details
              key={group.label}
              className={group.pages.some((child) => child === page) ? 'current-group' : undefined}
              open={group.pages.some((child) => child === page) || undefined}
            >
              <summary>
                <Icon className="nav-group-icon" size={20} aria-hidden="true" />
                <span>{group.label}</span>
                <ChevronDown className="nav-chevron" size={16} aria-hidden="true" />
              </summary>
              <div className="subnav">
                {group.pages.map((child) => (
                  <AsyncButton
                    key={child}
                    className={child === page ? 'active' : ''}
                    aria-current={child === page ? 'page' : undefined}
                    onClick={() => {
                      onNavigate(child);
                      setOpen(false);
                    }}
                  >
                    {child}
                  </AsyncButton>
                ))}
              </div>
            </details>
          );
        })}
        <AsyncButton
          className={`trash-nav ${page === '回收站' ? 'active' : ''}`}
          aria-current={page === '回收站' ? 'page' : undefined}
          onClick={() => {
            onNavigate('回收站');
            setOpen(false);
          }}
        >
          <Trash2 size={20} aria-hidden="true" />
          <span>回收站</span>
          {trashCount > 0 && <span className="trash-count">{trashCount}</span>}
        </AsyncButton>
      </nav>
      <div className="side-note">
        {desktop ? '数据保存在本机数据库' : '当前为浏览器预览模式'}
        <br />
        无需账号或网络
        <br />
        作者：路泽
      </div>
    </aside>
  );
}
