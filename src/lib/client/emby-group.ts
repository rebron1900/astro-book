/**
 * 剧集聚合卡的「当天看了哪些集」面板。
 *
 * 卡片本身带一个 <template>，里面是这组剧集的集号 / 集名 / 进度和进度条；
 * 只有集数区间（S01E131–E133）是触发点，悬停或键盘聚焦时把模板克隆进 tippy。
 * 卡片标题和简介的截断仍走全站统一的 reading-truncation，不受这里影响。
 *
 * 为什么改成「悬停时才建实例」（2026-11-25 线上实测）：
 * - 预建实例会被 tippy.ts 的 `astro:before-swap → destroyAllTippy()` 清掉，而这个事件
 *   在首屏比本模块的挂载还晚到；之后没有新的 DOM 变更，refresh 不再触发，
 *   结果就是 tabindex 还在、tippy 已经被销毁，悬停完全没反应（与页面加载时机强相关）。
 * - 所以在 pointerover / focusin 的当下才建实例并立刻 show：没有任何时机可以被抢走。
 * 事件走 document 上的委托，换页与无限滚动新插入的卡片自动生效，无需重新扫描。
 */
import type { Instance } from 'tippy.js';
import { createTippy } from './tippy';

type Host = HTMLElement & { _tippy?: Instance };

const SELECTOR = '.emby-episode-range';
const BOOTSTRAP = '__embyGroups';
type GlobalWithGroups = typeof globalThis & { [BOOTSTRAP]?: boolean };

/** 自己留一份引用：tippy 销毁时会 delete 元素上的 _tippy，WeakMap 用来判断是否需要重建。 */
const owned = new WeakMap<HTMLElement, Instance>();

function ensure(el: Host): Instance | null {
    const existing = el._tippy ?? owned.get(el);
    if (existing && !existing.state.isDestroyed) return existing;

    const template = el.closest('.emby-group')?.querySelector('template.emby-episode-template');
    if (!(template instanceof HTMLTemplateElement)) return null;

    el.setAttribute('tabindex', '0');
    const [instance] = createTippy(el, {
        content: () => {
            const wrap = document.createElement('div');
            wrap.className = 'emby-episode-wrap';
            wrap.appendChild(template.content.cloneNode(true));
            return wrap;
        },
        theme: 'emby-episodes',
        appendTo: () => document.body,
        maxWidth: 'min(30rem, 92vw)',
        interactive: false,
        trigger: 'manual',
        offset: [0, 8]
    });
    if (instance) owned.set(el, instance);
    return instance ?? null;
}

function targetOf(event: Event): Host | null {
    const node = event.target;
    if (!(node instanceof Element)) return null;
    return node.closest<Host>(SELECTOR);
}

function bootstrap(): void {
    const g = globalThis as GlobalWithGroups;
    if (g[BOOTSTRAP]) return;
    g[BOOTSTRAP] = true;

    const show = (event: Event) => {
        const el = targetOf(event);
        if (el) ensure(el)?.show();
    };

    const hide = (event: Event) => {
        const el = targetOf(event);
        if (!el) return;
        const next = (event as PointerEvent | FocusEvent).relatedTarget;
        if (next instanceof Node && el.contains(next)) return;
        (el._tippy ?? owned.get(el))?.hide();
    };

    document.addEventListener('pointerover', show);
    document.addEventListener('pointerout', hide);
    document.addEventListener('focusin', show);
    document.addEventListener('focusout', hide);

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll<Host>(SELECTOR).forEach((el) => {
            const inst = el._tippy ?? owned.get(el);
            if (inst?.state.isVisible) inst.hide();
        });
    });

    // 只为键盘可达性打标记（不建实例）；新插入的卡片由观察器补
    const mark = (root: ParentNode = document) => {
        root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
        });
    };
    mark();
    document.addEventListener('astro:page-load', () => mark());
    document.addEventListener('astro:after-swap', () => mark());

    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => mark());
    const start = () => observer.observe(document.body, { childList: true, subtree: true });
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
}

/** 由 List.astro 通过 onPageLoad 调用；引导器常驻，导航后不需要重新装。 */
export function initEmbyGroups(): () => void {
    bootstrap();
    return () => {};
}
