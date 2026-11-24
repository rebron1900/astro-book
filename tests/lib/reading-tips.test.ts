import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { initReadingTips } from '../../src/lib/client/reading-tips';

const clickEvent = (detail: number) => {
    const ev = new (globalThis as any).window.Event('click', { cancelable: true });
    Object.defineProperty(ev, 'detail', { value: detail });
    return ev;
};

const setup = () => {
    const { window, document } = parseHTML(`<html><body><div class="reading-card" data-timeline-list>
      <button data-rd-trigger aria-controls="t1" aria-expanded="false">开</button>
      <div id="t1" hidden></div></div></body></html>`);
    (globalThis as any).window = window;
    (globalThis as any).document = document;
    (globalThis as any).MutationObserver = class {
        observe() {}
        disconnect() {}
    };
    const btn = document.querySelector('[data-rd-trigger]') as any;
    const tip = document.getElementById('t1') as any;
    let focusVisible = false;
    btn.matches = () => focusVisible;
    initReadingTips();
    return { window, btn, tip, setFocusVisible: (v: boolean) => (focusVisible = v) };
};

describe('reading tips 键盘路径', () => {
    it('Tab 打开后第一次 Enter 不会把它关掉，第二次才收起', () => {
        const { window, btn, tip, setFocusVisible } = setup();
        setFocusVisible(true);
        btn.dispatchEvent(new window.Event('focus'));
        expect(tip.hidden).toBe(false);
        btn.dispatchEvent(clickEvent(0));
        expect(tip.hidden).toBe(false);
        btn.dispatchEvent(clickEvent(0));
        expect(tip.hidden).toBe(true);
    });

    it('鼠标点击仍然是一次开一次关', () => {
        const { btn, tip } = setup();
        btn.dispatchEvent(clickEvent(1));
        expect(tip.hidden).toBe(false);
        btn.dispatchEvent(clickEvent(1));
        expect(tip.hidden).toBe(true);
    });
});
