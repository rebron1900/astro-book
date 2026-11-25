/**
 * 阅读卡片「被截断才给全文」的 tooltip。
 *
 * 书名 / 作者是单行 nowrap + ellipsis，简介是两行 -webkit-line-clamp；
 * 一旦内容超出可用宽度（或行数），就挂一个 tippy 面板显示完整纯文本。
 * 没被截断的元素一个都不挂，避免满屏无效提示。
 *
 * 走全站同一套 tippy（createTippy + 全局 .tippy-box 外观 + appendTo body），
 * 和划线面板是各自独立的实例：这里 trigger 用 tippy 默认的 hover / focus，
 * 不会因为悬停整张卡片就弹。
 *
 * 触发重算的时机：卡片插入后（含无限滚动）、窗口 resize、字体加载完成。
 * 不再截断时销毁实例并摘掉 tabindex，键盘 Tab 不会留下无意义停留点。
 * Esc 收起全部面板。
 */
import type { Instance } from 'tippy.js';
import { createTippy } from './tippy';
import { afterTransition } from './idle';

const SELECTOR =
    '.reading-card .reading-titleline .entry-title, .reading-card .reading-titleline .reading-author, .reading-card .reading-desc';

/** tippy 把实例挂在元素上，类型里没声明。 */
type Host = HTMLElement & { _tippy?: Instance };

function isTruncated(el: Host): boolean {
    if (el.classList.contains('reading-desc')) return el.scrollHeight > el.clientHeight + 1;
    return el.scrollWidth > el.clientWidth + 1;
}

function attach(el: Host): void {
    if (el._tippy) return;
    el.setAttribute('tabindex', '0');
    createTippy(el, {
        content: el.textContent ?? '',
        allowHTML: false,
        theme: 'reading-full',
        appendTo: () => document.body,
        maxWidth: 'min(26rem, 92vw)',
        interactive: false,
        onShow(instance) {
            // 文本可能在字体加载后变化，每次显示前同步一次
            instance.setContent(el.textContent ?? '');
        }
    });
}

function detach(el: Host): void {
    if (!el._tippy) return;
    el._tippy.destroy();
    el.removeAttribute('tabindex');
}

function refresh(root: ParentNode = document): void {
    root.querySelectorAll<Host>(SELECTOR).forEach((el) => {
        try {
            if (isTruncated(el)) attach(el);
            else detach(el);
        } catch (error) {
            console.warn('[reading-truncation] tooltip 挂载失败', error);
        }
    });
}

export function initReadingTruncation(): () => void {
    let frame = 0;
    const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            refresh();
        });
    };

    // 等页面过渡与字体稳定后再第一次量：字体换了宽度会变
    const boot = afterTransition(() => refresh());
    if (typeof document !== 'undefined' && document.fonts?.ready) {
        document.fonts.ready.then(schedule).catch(() => undefined);
    }

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll<Host>(SELECTOR).forEach((el) => {
            if (el._tippy?.state.isVisible) el._tippy.hide();
        });
    };

    window.addEventListener('resize', schedule);
    document.addEventListener('keydown', onKeyDown);

    // 无限滚动新插入的卡片也要补上
    const list = document.querySelector('[data-timeline-list]');
    const observer =
        list && typeof MutationObserver !== 'undefined'
            ? new MutationObserver(() => schedule())
            : null;
    observer?.observe(list as Node, { childList: true, subtree: true });

    return () => {
        boot();
        observer?.disconnect();
        window.removeEventListener('resize', schedule);
        document.removeEventListener('keydown', onKeyDown);
        if (frame) cancelAnimationFrame(frame);
        document.querySelectorAll<Host>(SELECTOR).forEach(detach);
    };
}
