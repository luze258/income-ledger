export const navigationGroups = [
  { label: '商品管理', pages: ['商品列表', '分类与费用模板'] },
  { label: '库存管理', pages: ['当前库存', '库存变动记录'] },
  { label: '回款与资金', pages: ['资金概览', '回款管理', '售后记录'] },
  { label: '统计分析', pages: ['收益概览', '月度报表', '年度报表', '排行榜'] },
  { label: '设置', pages: ['外观与使用偏好', '数据备份与导入'] },
] as const;

export type Page = '首页' | '回收站' | (typeof navigationGroups)[number]['pages'][number];
const legacyPages: Record<string, Page> = {
  商品: '商品列表',
  库存: '当前库存',
  统计: '收益概览',
  设置: '外观与使用偏好',
};
export function resolvePage(value: string): Page {
  if (legacyPages[value]) return legacyPages[value];
  if (
    value === '首页' ||
    value === '回收站' ||
    navigationGroups.some((group) => group.pages.some((page) => page === value))
  )
    return value as Page;
  return '首页';
}
