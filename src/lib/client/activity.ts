/**
 * `/activity/` 里两块岛之间的通信：右侧栏的「地点筛选」→ 地图。
 *
 * 两边分属不同的 Solid 岛（侧栏在地图的 toc 插槽里），拿不到同一个组件作用域，
 * 用 document 事件传递「当前选中的地名集合」最省事，也和站内其它岛的通信方式一致。
 */
export const ACTIVITY_PLACE_FILTER_EVENT = 'activity:place-filter';

export interface ActivityPlaceFilterDetail {
    /** 选中的地名；空数组表示不过滤 */
    names: string[];
}

/**
 * `/activity/` 的当前模式广播：切换按钮 → 两个地图岛。
 * 岛只在自己那个模式激活时才创建地图，保证同一时刻只有一个 Mapbox 实例。
 */
export const ACTIVITY_MODE_EVENT = 'activity:mode';

export interface ActivityModeDetail {
    mode: 'exercise' | 'footprint';
}

/** 点「成就」时把对应标点在地图上聚焦（成就列表 → 足迹地图岛） */
export const ACTIVITY_FOCUS_PLACE_EVENT = 'activity:focus-place';

export interface ActivityFocusPlaceDetail {
    placeId: string;
}
