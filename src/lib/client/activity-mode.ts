import { ACTIVITY_FOCUS_PLACE_EVENT, ACTIVITY_MODE_EVENT, type ActivityFocusPlaceDetail, type ActivityModeDetail } from './activity';
import { prefersReducedMotion } from './dom';
import { createTippy } from './tippy';

/**
 * `/activity/` 顶部「运动 / 足迹」的切换。
 *
 * 当前模式写在 `.activity-page[data-activity-mode]` 上：
 * - 时间线、右侧栏用 CSS 跟着切
 * - 两个地图岛收听 ACTIVITY_MODE_EVENT，决定自己该不该活着（同一时刻只有一个 Mapbox 实例）
 */
export default function initActivityMode(): () => void {
    const page = document.querySelector<HTMLElement>('.activity-page');
    if (!page) return () => {};

    const buttons = [...page.querySelectorAll<HTMLButtonElement>('.act-switch-btn')];
    if (buttons.length === 0) return () => {};

    /** 当前模式下负责占高度的地图块：运动是 hero（含筛选条），足迹是地图外层窗口 */
    const mapBlock = (mode: string) => document.querySelector<HTMLElement>(mode === 'footprint' ? '.ex-fp-map-wrap' : '.ex-map-hero');

    /**
     * 吸顶与否只认一个判据：哨兵是否已经滚出视口顶部。
     * 不用 IntersectionObserver 回调里的 entry.isIntersecting —— 那个值可能在切模式、
     * 布局刚变的那一刻就过期了，拿它覆盖 DOM 会让地图已经吸顶却没有投影（或反过来）。
     */
    const stickyBySentinel = (sentinel: Element | null) => (sentinel ? sentinel.getBoundingClientRect().bottom <= 0 : false);

    /** 切模式时按当前滚动位置确定新地图的吸顶态，避免 display:none → block 时误判 */
    const syncStuckState = (mode: string) => {
        if (mode === 'footprint') {
            const map = document.querySelector<HTMLElement>('.ex-fp-map-wrap');
            if (map) map.classList.toggle('is-stuck', stickyBySentinel(document.querySelector('.act-fp-sentinel')));
            return;
        }
        // 运动地图的 is-stuck 同时由 Solid 的 state 驱动；这里先按哨兵位置同步 DOM，
        // 下面广播 ACTIVITY_MODE_EVENT 后 Solid 会保持同一个值，后面测高度才不会读到旧高度。
        const hero = document.querySelector<HTMLElement>('.ex-map-hero');
        if (hero) hero.classList.toggle('is-stuck', stickyBySentinel(document.querySelector('.ex-map-sentinel')));
    };

    /**
     * 足迹和运动地图的悬浮高度不同（运动多一条筛选条，足迹地图本身更高），
     * 切模式时直接从旧高度过渡到新高度，而不是让下方内容瞬移。
     */
    let heightAnimTimer: ReturnType<typeof setTimeout> | null = null;
    let heightAnimElement: HTMLElement | null = null;
    let heightAnimToken = 0;
    const clearHeightAnimation = () => {
        if (heightAnimTimer !== null) {
            clearTimeout(heightAnimTimer);
            heightAnimTimer = null;
        }
        if (heightAnimElement) {
            heightAnimElement.style.transition = '';
            heightAnimElement.style.removeProperty('block-size');
            heightAnimElement.style.overflow = '';
            heightAnimElement = null;
        }
    };
    /** 清掉上一条高度动画留下的内联 block-size，避免下一次切模式继承旧高度 */
    const clearInlineHeight = (element: HTMLElement | null) => {
        if (!element) return;
        element.style.removeProperty('block-size');
        element.style.transition = '';
        element.style.overflow = '';
    };

    const animateMapHeight = (mode: string, fromHeight: number) => {
        const target = mapBlock(mode);
        if (!target || fromHeight <= 0 || prefersReducedMotion()) return;

        // 目标高度必须按「吸顶态已经生效后的最终布局」测：切换瞬间新地图刚从 display:none
        // 出来，且 is-stuck 的 CSS 高度可能还在过渡，直接量 rect 会读到旧高度（就是悬浮态切错的原因）。
        target.classList.add('is-measuring-height');
        const toHeight = target.getBoundingClientRect().height;
        target.classList.remove('is-measuring-height');
        if (!toHeight || Math.abs(toHeight - fromHeight) < 1) {
            clearInlineHeight(target);
            return;
        }

        clearHeightAnimation();
        const token = ++heightAnimToken;
        heightAnimElement = target;
        target.style.overflow = 'hidden';
        target.style.transition = 'none';
        target.style.setProperty('block-size', `${fromHeight}px`);
        // 先让浏览器记住起始高度，下一帧再切到目标高度，CSS transition 才会真正播放
        void target.offsetHeight;
        requestAnimationFrame(() => {
            if (token !== heightAnimToken) return;
            target.style.transition = 'block-size 280ms cubic-bezier(0.22, 1, 0.36, 1)';
            target.style.setProperty('block-size', `${toHeight}px`);
            heightAnimTimer = setTimeout(() => {
                if (token !== heightAnimToken) return;
                heightAnimTimer = null;
                target.style.transition = '';
                target.style.removeProperty('block-size');
                target.style.overflow = '';
                heightAnimElement = null;
            }, 320);
        });
    };

    const apply = (mode: string) => {
        const previousMode = page.getAttribute('data-activity-mode') ?? 'exercise';
        const fromHeight = mapBlock(previousMode)?.getBoundingClientRect().height ?? 0;
        // 先把上一次切模式可能残留的内联高度清掉；否则新地图会继承运动地图的 block-size
        clearHeightAnimation();
        clearInlineHeight(mapBlock(previousMode));
        clearInlineHeight(mapBlock(mode));
        page.setAttribute('data-activity-mode', mode);
        syncStuckState(mode);
        for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.actMode === mode));
        document.dispatchEvent(new CustomEvent<ActivityModeDetail>(ACTIVITY_MODE_EVENT, { detail: { mode: mode === 'footprint' ? 'footprint' : 'exercise' } }));
        if (previousMode === mode) return;
        animateMapHeight(mode, fromHeight);
    };

    const onClick = (event: Event) => {
        const target = event.target as HTMLElement | null;

        // 气泡里的地名：和地图标点气泡一样，点一下就聚焦过去
        const tipRow = target?.closest<HTMLElement>('.act-tip-row[data-place-id]');
        if (tipRow?.dataset.placeId) {
            tips.forEach((instance) => instance.hide());
            document.dispatchEvent(new CustomEvent<ActivityFocusPlaceDetail>(ACTIVITY_FOCUS_PLACE_EVENT, { detail: { placeId: tipRow.dataset.placeId } }));
            return;
        }

        // 成就卡片：点一下让地图聚焦到那个标点
        const achievement = target?.closest<HTMLElement>('[data-act-place]');
        if (achievement?.dataset.actPlace) {
            document.dispatchEvent(
                new CustomEvent<ActivityFocusPlaceDetail>(ACTIVITY_FOCUS_PLACE_EVENT, { detail: { placeId: achievement.dataset.actPlace } })
            );
            return;
        }

        const button = target?.closest<HTMLButtonElement>('.act-switch-btn');
        if (!button) return;
        apply(button.dataset.actMode ?? 'exercise');
    };

    // 用 document 代理：右栏在地图的 toc 插槽里，不是 .activity-page 的子节点
    document.addEventListener('click', onClick);
    // 首次挂载也广播一次，让两个岛各自判断要不要建地图（旧页面没有这个按钮，不受影响）
    apply(page.getAttribute('data-activity-mode') ?? 'exercise');

    // 右栏分布条的悬浮提示：和地图标点气泡同一套「标题 + 列表」结构
    const escape = (value: string) =>
        value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
    const bars = [...document.querySelectorAll<HTMLElement>('.act-bar-row[data-tip-places]')];
    let tips: ReturnType<typeof createTippy> = [];
    if (bars.length > 0) {
        tips = createTippy(bars, {
            allowHTML: true,
            placement: 'left',
            maxWidth: 260,
            theme: 'act-glass',
            // 要能移到气泡里滚列表、点地名，所以是交互式的：
            // 移出触发源不立刻关，只有移出气泡本身（或按 Esc）才关
            interactive: true,
            hideOnClick: false,
            trigger: 'mouseenter focus',
            appendTo: () => document.body,
            delay: [140, 220],
            content: (element: Element) => {
                const title = element.getAttribute('data-tip-title') ?? '';
                let refs: { id: string; name: string }[] = [];
                try {
                    refs = JSON.parse(element.getAttribute('data-tip-places') ?? '[]');
                } catch {
                    refs = [];
                }
                const rows = refs
                    .map((ref) => `<li><button class="act-tip-row" type="button" data-place-id="${escape(ref.id)}">${escape(ref.name)}</button></li>`)
                    .join('');
                return `<div class="act-tip"><p class="act-tip-head">${escape(title)} · ${refs.length} 个地方</p><ul class="act-tip-list">${rows}</ul></div>`;
            }
        });
    }

    // 足迹地图吸顶：和运动页一样，滚过哨兵就切到「悬浮条」形态
    //
    // 两点必须注意：
    // 1. 地图岛是 client:load，水合时会替换服务端那批 DOM。init 时把哨兵/地图节点存下来，
    //    观察器盯的就是一个已被摘出文档的旧节点，之后滚动再也不回调 —— 站内软导航进来后
    //    「地图吸顶了却没有投影」就是这么来的（整页刷新时偶发顺序对了才看不出问题）。
    //    所以回调和兜底里一律现查节点。
    // 2. IO 只在「跨过」时回调，首帧位置、字体/图片撑开布局、容器尺寸变化都不保证重算，
    //    加一条 rAF 节流的 scroll/resize 兜底，任何加载方式都跟得住，代价是每帧读一个 rect。
    const syncFootprintStuck = (): void => {
        const pageEl = document.querySelector('.activity-page');
        // 运动模式下这张地图是 display:none，此时哨兵 rect 恒为 0，
        // 算出来的是假状态；等切回足迹时由 syncStuckState 补上
        if (!pageEl || pageEl.getAttribute('data-activity-mode') !== 'footprint') return;
        const wrap = document.querySelector<HTMLElement>('.ex-fp-map-wrap');
        const sen = document.querySelector('.act-fp-sentinel');
        if (wrap && sen) wrap.classList.toggle('is-stuck', stickyBySentinel(sen));
    };

    let stuckFrame = 0;
    const onScrollSync = (): void => {
        if (stuckFrame) return;
        stuckFrame = requestAnimationFrame(() => {
            stuckFrame = 0;
            syncFootprintStuck();
        });
    };

    syncFootprintStuck();
    window.addEventListener('scroll', onScrollSync, { passive: true });
    window.addEventListener('resize', onScrollSync, { passive: true });

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(() => syncFootprintStuck(), { threshold: 0 });
        const liveSentinel = document.querySelector('.act-fp-sentinel');
        if (liveSentinel) observer.observe(liveSentinel);
    }

    return () => {
        document.removeEventListener('click', onClick);
        observer?.disconnect();
        if (stuckFrame) cancelAnimationFrame(stuckFrame);
        window.removeEventListener('scroll', onScrollSync);
        window.removeEventListener('resize', onScrollSync);
        clearHeightAnimation();
    };
}
