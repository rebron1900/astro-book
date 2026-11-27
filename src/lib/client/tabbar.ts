/**
 * 移动端底部导航的三件事：
 *
 * 1. 当前项：标签栏用 `transition:persist` 跨页保留（不再每次换页重建），所以服务端渲染的
 *    高亮在换页后不会刷新，这里按当前地址重算一次；
 * 2. 液态玻璃滑块：滑块是整格包住当前项的胶囊，换页/切换时从左滑到右，并在途中拉长一点；
 * 3. 「更多」浮层：开合只切一个类（html.bk-more-open），位移与透明度全交给 CSS。
 */
import { isActiveUrl } from '../utils/active-url';
import { onPageLoad } from './mount';

const GLIDE_DURATION = 480;

const reducedMotion = () =>
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 按当前地址点亮一格，并把滑块移到它下面；返回清理函数（这里没有常驻监听）。 */
const syncActive = () => {
    const nav = document.querySelector<HTMLElement>('[data-bk-tabs]');
    if (!nav) return;

    const items = [...nav.querySelectorAll<HTMLElement>('.bk-tab')];
    if (items.length === 0) return;

    const path = window.location.pathname;
    let index = -1;

    items.forEach((item, i) => {
        const moreUrls = item.dataset.moreNav;
        const active = moreUrls
            ? moreUrls.split('|').filter(Boolean).some((url) => isActiveUrl(path, url))
            : isActiveUrl(path, item.dataset.nav ?? '');

        item.classList.toggle('is-active', active);
        if (active) {
            index = i;
            item.setAttribute('aria-current', 'page');
        } else {
            item.removeAttribute('aria-current');
        }
    });

    const previous = Number.parseInt(nav.dataset.bkIndex ?? '', 10);
    nav.dataset.bkIndex = String(index);
    nav.classList.toggle('is-idle', index < 0);
    nav.style.setProperty('--bk-index', String(Math.max(index, 0)));

    // 只有真的换了格子才动滑块；首次渲染（服务端已经把位置写对）不跑动画
    if (index < 0 || !Number.isFinite(previous) || previous < 0 || previous === index) return;

    const fill = nav.querySelector<HTMLElement>('.bk-glide-fill');
    if (!fill || reducedMotion() || typeof fill.animate !== 'function') return;

    // 往右走从左边拉长、往左走从右边拉长，才是「液体被拖过去」的方向感
    fill.style.transformOrigin = index > previous ? 'left center' : 'right center';
    fill.animate(
        [
            { transform: 'scaleX(1)' },
            { transform: 'scaleX(1.16)', offset: 0.34 },
            { transform: 'scaleX(0.97)', offset: 0.68 },
            { transform: 'scaleX(1)' }
        ],
        { duration: GLIDE_DURATION, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
    );
};

/** 「更多」浮层的开合：Esc、点遮罩、点条目、滚动锁、焦点归还。 */
const bindMoreSheet = () => {
    const root = document.documentElement;
    const sheet = document.getElementById('bk-more-sheet');
    const openBtn = document.querySelector<HTMLButtonElement>('[data-bk-more-open]');
    if (!sheet || !openBtn) return () => {};

    const setOpen = (open: boolean) => {
        root.classList.toggle('bk-more-open', open);
        openBtn.setAttribute('aria-expanded', String(open));
        sheet.setAttribute('aria-hidden', String(!open));
    };

    const close = () => {
        if (!root.classList.contains('bk-more-open')) return;
        setOpen(false);
        // 焦点回到「更多」按钮本身：手机上的点击不一定把焦点给它，回 lastFocus 会落空
        openBtn.focus({ preventScroll: true });
    };

    const open = () => {
        setOpen(true);
        // 焦点落到面板第一项，键盘和读屏才跟得上；等一帧让面板先变成可见
        requestAnimationFrame(() => {
            sheet.querySelector<HTMLElement>('.bk-more-list a')?.focus({ preventScroll: true });
        });
    };

    const onClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (target.closest('[data-bk-more-open]')) {
            event.preventDefault();
            if (root.classList.contains('bk-more-open')) close();
            else open();
            return;
        }
        // 点遮罩，或点了面板里的链接（页面已经要走人了）都收起
        if (root.classList.contains('bk-more-open') && (target.closest('[data-bk-more-close]') || target.closest('.bk-more-list a'))) {
            setOpen(false);
        }
    };

    const onKeydown = (event: KeyboardEvent) => {
        if (!root.classList.contains('bk-more-open')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        // Tab 只在面板里转，别跑到背后的正文上
        if (event.key !== 'Tab') return;
        const focusables = [...sheet.querySelectorAll<HTMLElement>('a[href], button')].filter(
            (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);

    // 换页后一律从关闭态开始（标签栏与面板都是 persist 的，DOM 上的类不会自己清）
    setOpen(false);

    return () => {
        document.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKeydown);
        root.classList.remove('bk-more-open');
    };
};

export function bindTabBar(): void {
    onPageLoad(() => {
        syncActive();
        return bindMoreSheet();
    });
}
