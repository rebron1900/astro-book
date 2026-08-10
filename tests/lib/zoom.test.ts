import { compile } from 'sass';
import { describe, expect, it } from 'vitest';

function getLastNumericDeclaration(css: string, selector: string, property: string) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g');
    const declaration = new RegExp(`${property}\\s*:\\s*(-?\\d+)`);
    let value: number | null = null;

    for (const match of css.matchAll(rule)) {
        const propertyMatch = match[1].match(declaration);
        if (propertyMatch) value = Number(propertyMatch[1]);
    }

    return value;
}

describe('图片缩放全局样式', () => {
    it('放大图片的层级高于遮罩', () => {
        const css = compile('src/styles/book.scss', { style: 'expanded', quietDeps: true }).css;
        const overlayZIndex = getLastNumericDeclaration(css, '.medium-zoom-overlay', 'z-index');
        const imageZIndex = getLastNumericDeclaration(css, '.medium-zoom-image--opened', 'z-index');

        expect(overlayZIndex).not.toBeNull();
        expect(imageZIndex).not.toBeNull();
        expect(imageZIndex!).toBeGreaterThan(overlayZIndex!);
    });
});
