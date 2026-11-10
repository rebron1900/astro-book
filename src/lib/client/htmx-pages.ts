import htmx from 'htmx.org';
import { createTippy } from './tippy';
import { initCards } from './cards-loader';
import initZoom from './zoom';
import limitHight from './fold';
import initGallery from './gallery';

let memosBound = false;
let doubanBound = false;

/**
 * /now 页的 memos 交互：htmx 无限加载 + 新内容重新初始化 zoom/折叠/tippy。
 */
function initMemos() {
    if (!location.pathname.includes('/now')) return;

    limitHight();
    htmx.process(document.body);

    if (memosBound) return;
    memosBound = true;

    document.body.addEventListener('htmx:beforeSwap', function () {
        document.querySelector('.btn-more')?.remove();
    });

    document.body.addEventListener('htmx:afterSwap', function () {
        initZoom();
        initGallery();
        limitHight();
        void initCards();
        createTippy('.item-info', {
            allowHTML: true,
            interactive: true,
            maxWidth: 'none',
            theme: 'auto',
            appendTo: () => document.body
        });
    });
}

/**
 * /douban 页交互：htmx 无限加载，加载前移除加载更多按钮。
 */
function initDouban() {
    if (!location.pathname.includes('/douban')) return;

    htmx.process(document.body);

    if (doubanBound) return;
    doubanBound = true;

    document.body.addEventListener('htmx:beforeSwap', function () {
        document.querySelector('.btn-more')?.remove();
    });
}

/** 初始化 /now 与 /douban 的 htmx 交互。 */
export default function initHtmxPages() {
    initMemos();
    initDouban();
}
