import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { initReadingTips as InitType } from '../../src/lib/client/reading-tips';
import { parseHTML } from 'linkedom';

/**
 * reading-tips 现在只是把卡片上的划线 HTML 交给全站 tippy：绑过的不重复绑、空内容不建实例、
 * 新插入的卡片（无限滚动）靠 MutationObserver 补绑。tippy 本身要做 DOM 测量，这里打桩，
 * 只验证「绑定契约」这一层。
 */
const created: { target: unknown; options: Record<string, unknown> }[] = [];

const setup = (html: string) => {
    const { window, document } = parseHTML(`<html><body><div data-timeline-list>${html}</div></body></html>`);
    (globalThis as any).window = window;
    (globalThis as any).document = document;
    (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
    delete (globalThis as any).__readingTips;
    (globalThis as any).MutationObserver = class {
        observe() {}
        disconnect() {}
    };
};

beforeEach(() => {
    created.length = 0;
    vi.resetModules();
    vi.doMock('../../src/lib/client/tippy', () => ({
        createTippy: (target: unknown, options: Record<string, unknown>) => {
            created.push({ target, options });
            return [];
        }
    }));
});

describe('reading tips 绑定', () => {
    it('每张有划线的卡片只建一个 tippy，绑过的重跑不重复建', async () => {
        setup(`<div class="reading-card">
            <button data-rd-trigger data-tip-html="<p>a</p>" aria-label="x">i</button>
            <button data-rd-trigger data-tip-html="<p>b</p>" aria-label="y">i</button>
        </div>`);
        const { initReadingTips } = (await import('../../src/lib/client/reading-tips')) as { initReadingTips: typeof InitType };
        const before = created.length;
        const unique = new Set<unknown>();
        const cleanup = initReadingTips();
        initReadingTips();
        initReadingTips();
        await new Promise((r) => setTimeout(r, 30));
        // 每次 init 的同步阶段 + 过渡后的一帧各绑一遍，同一按钮始终只建一次实例
        for (const item of created.slice(before)) unique.add(item.target);
        expect(unique.size).toBe(2);
        expect(created.length).toBeGreaterThanOrEqual(2);
        expect(cleanup).toBeTypeOf('function');
        // 走全站 tippy 统一主题，并挂到 body 上才不会被卡片裁掉
        expect(created[0].options.theme).toBe('reading-hl');
        expect(created[0].options.allowHTML).toBe(true);
        const appendTo = created[0].options.appendTo as () => unknown;
        expect(appendTo()).toBe((globalThis as any).document.body);
        // 定位那一帧 popper 必须是 block（否则首次量出 0×0，面板不出现）
        // 同一按钮多次 init 只建一个实例：内容就是按钮上的划线 HTML
        expect(created[0].options.content).toBe('<p>a</p>');
        // 悬停/聚焦交给 tippy 默认链，onShow 里先量尺寸再摆放
        expect(created[0].options.onShow).toBeTypeOf('function');
        expect(created[0].options.trigger).toBeUndefined();

        const onCreate = created[0].options.onCreate as (i: { popper: { style: Record<string, string> } }) => void;
        const popper = { style: {} as Record<string, string> };
        onCreate({ popper });
        expect(popper.style.display).toBe('block');
    });

    it('没有划线内容的卡片不建实例', async () => {
        setup(`<div class="reading-card"><button data-rd-trigger data-tip-html="">i</button></div>`);
        const { initReadingTips } = await import('../../src/lib/client/reading-tips');
        initReadingTips();
        expect(created).toHaveLength(0);
    });
});
