import { describe, expect, it } from 'vitest';
import { isActiveUrl } from '../../src/lib/utils/active-url';

describe('导航激活判定', () => {
    it('二级页面命中父级菜单', () => {
        expect(isActiveUrl('/timeline/memo/2/', '/timeline/')).toBe(true);
        expect(isActiveUrl('/garden/graph/', '/garden/')).toBe(true);
        expect(isActiveUrl('/garden/22-knowledge/ai/', '/garden/')).toBe(true);
    });

    it('前缀相似的路径不误命中', () => {
        expect(isActiveUrl('/garden-foo/', '/garden/')).toBe(false);
        expect(isActiveUrl('/gardener_diary_1/', '/garden/')).toBe(false);
        expect(isActiveUrl('/archives/', '/')).toBe(false); // 首页 `/` 不吞所有页面
    });

    it('忽略查询串与尾斜杠', () => {
        expect(isActiveUrl('/garden/?x=1', '/garden')).toBe(true);
        expect(isActiveUrl('/garden', '/garden/')).toBe(true);
    });

    it('外链不参与激活', () => {
        expect(isActiveUrl('/garden/', 'https://garden.1900.live/')).toBe(false);
    });
});
