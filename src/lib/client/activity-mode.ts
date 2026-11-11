import { ACTIVITY_FOCUS_PLACE_EVENT, ACTIVITY_MODE_EVENT, type ActivityFocusPlaceDetail, type ActivityModeDetail } from './activity';

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

    const apply = (mode: string) => {
        page.setAttribute('data-activity-mode', mode);
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

    return () => document.removeEventListener('click', onClick);
}
