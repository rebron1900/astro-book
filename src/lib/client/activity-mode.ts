import { ACTIVITY_FOCUS_PLACE_EVENT, ACTIVITY_MODE_EVENT, type ActivityFocusPlaceDetail, type ActivityModeDetail } from './activity';
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

    /** 切模式时先把足迹地图的高度定死，避免 display:none → block 时播一次「窄 → 高」 */
    const freezeFootprintMap = () => {
        const map = document.querySelector<HTMLElement>('.ex-fp-map-wrap');
        if (!map) return;
        map.classList.add('act-no-anim');
        map.classList.toggle('is-stuck', map.getBoundingClientRect().top < 0);
        requestAnimationFrame(() => requestAnimationFrame(() => map.classList.remove('act-no-anim')));
    };

    const apply = (mode: string) => {
        page.setAttribute('data-activity-mode', mode);
        if (mode === 'footprint') freezeFootprintMap();
        for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.actMode === mode));
        document.dispatchEvent(new CustomEvent<ActivityModeDetail>(ACTIVITY_MODE_EVENT, { detail: { mode: mode === 'footprint' ? 'footprint' : 'exercise' } }));
    };

    const onClick = (event: Event) => {
        const target = event.target as HTMLElement | null;

        // 成就卡片：点一下让地图聚焦到那个标点
        const achievement = target?.closest<HTMLElement>('[data-act-place]');
        if (achievement?.dataset.actPlace) {
            document.dispatchEvent(new CustomEvent<ActivityFocusPlaceDetail>(ACTIVITY_FOCUS_PLACE_EVENT, { detail: { placeId: achievement.dataset.actPlace } }));
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
    const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
    const bars = [...document.querySelectorAll<HTMLElement>('.act-bar-row[data-tip-places]')];
    if (bars.length > 0) {
        createTippy(bars, {
            allowHTML: true,
            placement: 'left',
            maxWidth: 260,
            theme: 'auto',
            // 要能移到气泡里滚列表、点地名，所以是交互式的：
            // 移出触发源不立刻关，只有移出气泡本身（或按 Esc）才关
            interactive: true,
            hideOnClick: false,
            trigger: 'mouseenter focus',
            appendTo: () => document.body,
            delay: [140, 220],
            content: (element: Element) => {
                const title = element.getAttribute('data-tip-title') ?? '';
                let names: string[] = [];
                try {
                    names = JSON.parse(element.getAttribute('data-tip-places') ?? '[]');
                } catch {
                    names = [];
                }
                const rows = names.map((name) => `<li class="act-tip-row">${escape(name)}</li>`).join('');
                return `<div class="act-tip"><p class="act-tip-head">${escape(title)} · ${names.length} 个地方</p><ul class="act-tip-list">${rows}</ul></div>`;
            }
        });
    }

    // 足迹地图吸顶：和运动页一样，滚过哨兵就切到「悬浮条」形态
    const sentinel = document.querySelector('.act-fp-sentinel');
    const fpMap = document.querySelector<HTMLElement>('.ex-fp-map-wrap');
    let observer: IntersectionObserver | null = null;
    if (sentinel && fpMap && typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry) fpMap.classList.toggle('is-stuck', !entry.isIntersecting);
            },
            { threshold: 0 }
        );
        observer.observe(sentinel);
    }

    return () => {
        document.removeEventListener('click', onClick);
        observer?.disconnect();
    };
}
