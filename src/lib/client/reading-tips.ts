/**
 * 阅读卡片划线的 tooltip。
 *
 * 走全站同一套 tippy（createTippy + appendTo body，卡片外观来自全局 .tippy-box），而不是自建 disclosure 面板：
 * - 面板挂在 body 上，不再被卡片自身的层叠/裁剪压住（卡片在网格里，往下展开会被后面的卡片盖住）；
 * - 外观和站内其它 tooltip（书籍作者、评论摘录、花园预览）一致，统一在全局 .tippy-box 里定义。
 *
 * 「已绑定」记录放在 globalThis 上（而不是模块变量）：这个模块可能被重复求值，
 * 用模块变量做标记时换页后新节点会被当成已绑过，面板再也不建。
 *
 * 两个实测坑（都在浏览器里复现过）：
 * 1. 懒绑定（第一次 hover 才建实例）时，tippy 首次定位量出 0×0，面板不出现；
 *    所以等一次过渡动画结束后统一预建实例（afterTransition）。
 * 2. 预建实例的第一次 show 也可能定位失败；而同一实例 hide 再 show 就正常。
 *    因此悬停时先把面板在屏外（-9999px）摆好、量出真实尺寸，再按图标位置把它放好，
 *    之后交给 tippy 正常管理（trigger 用 tippy 默认的 mouseenter/focus 链）。
 * 预建是逐个 try/catch 的，哪一张卡片建失败都不影响其余；悬停/聚焦时还会再补一次。
 *
 * 由 List.astro 通过 onPageLoad(initReadingTips) 挂载；无限滚动新插入的卡片靠 MutationObserver 补挂。
 */
import type { Instance } from 'tippy.js';
import { createTippy } from './tippy';
import { afterTransition } from './idle';

const TRIGGER_SELECTOR = '[data-rd-trigger]';
const GAP = 8;
const EDGE = 8;
const MIN_WIDTH = 240;

/** tippy 把实例挂在元素上，类型里没声明。 */
type TippyHost = HTMLElement & { _tippy?: Instance };
type ReadingTipsState = { ids: WeakSet<HTMLElement>; seq: number };
type GlobalWithTips = typeof globalThis & { __readingTips?: ReadingTipsState };

function state(): ReadingTipsState {
    const g = globalThis as GlobalWithTips;
    if (!g.__readingTips) g.__readingTips = { ids: new WeakSet<HTMLElement>(), seq: 0 };
    return g.__readingTips;
}

/** 先把面板放到屏外量尺寸，再按图标位置把它放到「图标左下方、避开视口边缘」的位置。 */
function placeBeside(instance: Instance): void {
    const popper = instance.popper;
    const box = popper.querySelector('.tippy-box') as HTMLElement | null;
    if (!box) return;

    // 1) 屏外摆好并量尺寸（此时 display 必须是 block，全局样式没给 .tippy-box 定 display）
    popper.style.display = 'block';
    box.style.visibility = 'hidden';
    popper.style.transform = 'translate(0px, -9999px)';
    const width = Math.max(box.offsetWidth, MIN_WIDTH);
    const height = box.offsetHeight;

    // 2) 按图标矩形算位置：默认放在下方左侧，放不下就翻上去 / 贴右边缘
    const ref = instance.reference.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = ref.left;
    if (left + width > vw - EDGE) left = vw - EDGE - width;
    if (left < EDGE) left = EDGE;
    let top = ref.bottom + GAP;
    if (top + height > vh - EDGE && ref.top - GAP - height > EDGE) top = ref.top - GAP - height;

    popper.style.left = '0px';
    popper.style.top = '0px';
    popper.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    box.style.visibility = '';
}

function attach(btn: TippyHost): void {
    if (btn._tippy) return;
    const html = btn.dataset.tipHtml ?? '';
    if (!html) return;
    createTippy(btn, {
        content: html,
        allowHTML: true,
        // reading-hl 只是这一个面板的限定（限高滚动），卡片外观仍由全局 .tippy-box 决定
        theme: 'reading-hl',
        interactive: true,
        appendTo: () => document.body,
        maxWidth: 'min(26rem, 92vw)',
        onCreate(instance) {
            instance.popper.style.display = 'block';
        },
        onShow(instance) {
            placeBeside(instance);
        }
    });
    state().ids.add(btn);
}

/** 逐个建实例：单个失败（某一张卡片的 DOM 异常）不能拖住后面全部卡片。 */
function bind(root: ParentNode = document): void {
    root.querySelectorAll<TippyHost>(TRIGGER_SELECTOR).forEach((btn) => {
        if (btn._tippy) return;
        try {
            attach(btn);
        } catch (error) {
            // 单张卡片建实例失败不该拖住其余卡片：只告警，悬停时还会再试一次
            console.warn('[reading-tips] 划线面板建实例失败', error);
        }
    });
}

/** 悬停/聚焦时如果还没有实例（上面的预建失败，或懒加载进来的新卡片），就地补一个。 */
function ensure(hovered: TippyHost): void {
    if (hovered._tippy) return;
    try {
        attach(hovered);
    } catch {
        return;
    }
}

export function initReadingTips(): (() => void) | void {
    // 新的一次页面挂载：旧 DOM 已随页面换掉，记录重开
    const s = state();
    s.seq += 1;
    s.ids = new WeakSet<HTMLElement>();

    // 过渡动画跑完再统一建：此时布局与字体已稳，首次量尺寸不会算成 0×0
    const boot = afterTransition(() => bind());
    bind();

    const onOver = (event: Event) => {
        const btn = (event.target as Element | null)?.closest?.(TRIGGER_SELECTOR) as TippyHost | null;
        if (btn) ensure(btn);
    };
    const onFocus = (event: Event) => {
        const btn = (event.target as Element | null)?.closest?.(TRIGGER_SELECTOR) as TippyHost | null;
        if (btn) ensure(btn);
    };
    // Esc 关闭（tippy 默认不管 Esc）：悬停中或键盘聚焦中都能收起
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll<TippyHost>(TRIGGER_SELECTOR).forEach((btn) => {
            if (btn._tippy?.state.isVisible) btn._tippy.hide();
        });
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKeyDown);

    // 无限滚动新插入的卡片也要绑上
    const list = document.querySelector('[data-timeline-list]');
    if (!list || typeof MutationObserver === 'undefined') {
        return () => {
            boot();
            document.removeEventListener('pointerover', onOver);
            document.removeEventListener('focusin', onFocus);
            document.removeEventListener('keydown', onKeyDown);
        };
    }
    const observer = new MutationObserver(() => bind(list));
    observer.observe(list, { childList: true, subtree: true });
    return () => {
        observer.disconnect();
        boot();
        document.removeEventListener('pointerover', onOver);
        document.removeEventListener('focusin', onFocus);
        document.removeEventListener('keydown', onKeyDown);
    };
}
