import { describe, expect, it } from 'vitest';
import { navigationGroups, resolvePage } from './navigation';

describe('页面位置兼容', () => {
  it('将旧版六个入口恢复到新版对应页面', () => {
    expect(['首页', '商品', '库存', '统计', '设置', '回收站'].map(resolvePage)).toEqual([
      '首页',
      '商品列表',
      '当前库存',
      '收益概览',
      '外观与使用偏好',
      '回收站',
    ]);
  });
  it('允许恢复所有二级页面，未知偏好回到首页', () => {
    for (const group of navigationGroups)
      for (const page of group.pages) expect(resolvePage(page)).toBe(page);
    expect(resolvePage('旧版不存在的页面')).toBe('首页');
  });
});
