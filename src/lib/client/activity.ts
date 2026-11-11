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
