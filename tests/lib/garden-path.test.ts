import { describe, expect, it } from 'vitest';
import { isGardenPath } from '../../src/lib/garden/path';

describe('garden path 判定', () => {
    it('花园根与子路径命中', () => {
        expect(isGardenPath('/garden')).toBe(true);
        expect(isGardenPath('/garden/')).toBe(true);
        expect(isGardenPath('/garden/22-knowledge/22-knowledge/')).toBe(true);
        expect(isGardenPath('/garden/tags/privacy/')).toBe(true);
    });

    it('前缀相似的路径不能误判', () => {
        expect(isGardenPath('/garden-foo')).toBe(false);
        expect(isGardenPath('/gardener_diary_1/')).toBe(false);
        expect(isGardenPath('/')).toBe(false);
        expect(isGardenPath('/archives/')).toBe(false);
        expect(isGardenPath('/garden/graph')).toBe(true); // 图谱页属于花园
    });
});
