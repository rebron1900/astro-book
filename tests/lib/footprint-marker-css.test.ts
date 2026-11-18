import { compile } from 'sass';
import { describe, expect, it } from 'vitest';

/** 取出选择器完全等于 selector 的那一条规则体（同名子选择器不算） */
function ruleBody(css: string, selector: string): string | null {
    // sass 的 expanded 输出保留了注释：注释里的 { } 也会干扰按大括号切块
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (match[1].trim() === selector) return match[2];
    }
    return null;
}

describe('足迹标点光晕的合成层', () => {
    const css = compile('src/styles/pages/exercise.scss', { style: 'expanded', quietDeps: true }).css;

    it('基础态不提升合成层', () => {
        // 每个标点都带一枚光晕，基础态常驻 will-change 会变成上百个合成层，
        // 压在每帧重绘的地形画布上，自动旋转时明显掉帧
        const base = ruleBody(css, '.ex-fp-halo');
        expect(base).not.toBeNull();
        expect(base).not.toContain('will-change');
    });

    it('只有激活点（真的播放呼吸动画）才提升', () => {
        const active = ruleBody(css, '.ex-fp-point.is-active .ex-fp-halo');
        expect(active).not.toBeNull();
        expect(active).toContain('will-change');
        expect(active).toContain('animation');
    });
});
