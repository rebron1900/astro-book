/**
 * 运动记录的数据契约。
 *
 * 数据源：intervals.icu（脚本 `scripts/sync-data.mjs` 的 `intervals` 源拉取全量活动，
 * 写入 `src/data/activities.json`）。构建期只读本地 JSON，不依赖运行时网络。
 *
 * 字段刻意保持「扁平 + 只放页面真正用得到的值」，避免把 intervals.icu 的完整
 * Activity 对象（180+ 字段）带进仓库。轨迹不进列表接口，单独按活动 ID 缓存。
 */
export interface Activity {
    /** intervals.icu 活动 ID，字符串，形如 `i204300274` */
    id: string;
    name: string;
    /** 距离（米） */
    distance: number;
    /** 移动时长（秒） */
    moving_time: number;
    /** intervals.icu 活动类型：Run / Ride / Walk / Hike / RockClimbing / StairStepper ... */
    type: string;
    /** UTC 开始时间，ISO 8601 带 Z，如 `2026-10-11T08:06:19Z` */
    start_date: string;
    /** 本地墙上时间 `YYYY-MM-DD HH:mm:ss`（无时区，页面按此展示） */
    start_date_local: string;
    /** 平均心率（bpm），无数据为 null */
    average_heartrate: number | null;
    /** 平均速度（m/s），无数据为 null；跑步/步行页面会换算成配速 */
    average_speed: number | null;
    /** 累计爬升（米） */
    elevation_gain: number;
    /** 编码轨迹（Google polyline，lat/lng 顺序，精度 1e-5）；仅距离 > 0 且取到地图的活动有值 */
    polyline?: string;
    /** intervals.icu 活动页链接 */
    url?: string;
    /** intervals.icu 的 source 字段，如 ZEPP / UPLOAD */
    source?: string;
}
