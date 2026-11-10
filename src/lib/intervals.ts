/**
 * intervals.icu 同步支撑：把上游活动对象映射成 `Activity` 契约，并处理轨迹编码。
 *
 * 这里只放纯函数（不碰网络、不读写文件），由 `scripts/sync-data.mjs` 在同步时调用，
 * 同时供单元测试直接验证。数据源说明见 `activity-types.ts`。
 */
import type { Activity } from './activity-types';

/** 轨迹最多保留的点数：地图折线只用于卡片背景，不需要把几万个点写进数据文件。 */
export const MAX_ROUTE_POINTS = 1500;

/** 活动没有任何名称时展示的占位文案（与页面其它运动卡片一致）。 */
const DEFAULT_ACTIVITY_NAME = '运动记录';

/** intervals.icu 列表接口返回的活动对象（只列同步用得到的字段，其余字段一律忽略）。 */
export interface IntervalsActivity {
    id: string;
    name?: string | null;
    type?: string | null;
    sub_type?: string | null;
    start_date?: string | null;
    start_date_local?: string | null;
    distance?: number | null;
    moving_time?: number | null;
    elapsed_time?: number | null;
    average_heartrate?: number | null;
    average_speed?: number | null;
    total_elevation_gain?: number | null;
    source?: string | null;
    external_id?: string | null;
}

function finiteNumber(value: unknown): number | null {
    // Number(null) === 0，会让「无数据」被误判成 0，这里显式排除空值。
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

/** 取整的数值字段：缺失/null/非数字统一落到 0，避免把 NaN 写进 JSON。 */
function roundedNumber(value: unknown): number {
    const number = finiteNumber(value);
    return number === null ? 0 : Math.round(number);
}

/** 本地墙上时间：`2026-10-11T08:06:19` -> `2026-10-11 08:06:19` */
function toLocalDateTime(value: unknown, fallback: unknown): string {
    const text = typeof value === 'string' && value.trim() ? value.trim() : typeof fallback === 'string' ? fallback.trim() : '';
    return text.replace('T', ' ').slice(0, 19);
}

/**
 * UTC 开始时间统一成 `YYYY-MM-DDTHH:mm:ssZ`。
 * intervals.icu 的 `start_date` 本身就是 UTC，可能带毫秒或 `+00:00`；带时区偏移的输入先换算成 UTC。
 */
export function toUtcIso(value: unknown, localFallback = ''): string {
    const text = typeof value === 'string' ? value.trim() : '';
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(text);
    if (!match) {
        // 上游没给 UTC 时间时，用本地墙上时间补一个（旧行为：start_date || local + 'Z'）
        return localFallback ? `${localFallback.replace(' ', 'T')}Z` : '';
    }
    if (/[+-]\d{2}:?\d{2}$/.test(text)) {
        const time = Date.parse(text);
        if (Number.isFinite(time)) return `${new Date(time).toISOString().slice(0, 19)}Z`;
    }
    return `${match[1]}T${match[2]}Z`;
}

/** intervals.icu 原始活动 -> `Activity` 契约（distance/moving_time/爬升取整，缺失值给安全默认值）。 */
export function toActivity(raw: IntervalsActivity, polyline?: string): Activity {
    const startDateLocal = toLocalDateTime(raw.start_date_local, raw.start_date);
    const activity: Activity = {
        id: String(raw.id),
        name: (typeof raw.name === 'string' && raw.name.trim()) || DEFAULT_ACTIVITY_NAME,
        distance: roundedNumber(raw.distance),
        moving_time: roundedNumber(raw.moving_time),
        type: (typeof raw.type === 'string' && raw.type.trim()) || 'Other',
        start_date: toUtcIso(raw.start_date, startDateLocal),
        start_date_local: startDateLocal,
        average_heartrate: finiteNumber(raw.average_heartrate),
        average_speed: finiteNumber(raw.average_speed),
        elevation_gain: roundedNumber(raw.total_elevation_gain),
        url: `https://intervals.icu/activities/${raw.id}`
    };
    if (typeof raw.source === 'string' && raw.source.trim()) activity.source = raw.source.trim();
    if (typeof polyline === 'string' && polyline.length > 0) activity.polyline = polyline;
    return activity;
}

/**
 * Google encoded polyline 编码。
 * `points[i] = [lat, lng]`，与 `exercise.ts` 的 `decodeRoute`（返回 [lng, lat]）配套；
 * 顺序必须保持与历史数据一致，否则地图上的轨迹会翻转。
 */
export function encodePolyline(points: Array<[number, number]>): string {
    const encodeValue = (value: number): string => {
        let current = value < 0 ? ~(value << 1) : value << 1;
        let result = '';
        while (current >= 0x20) {
            result += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
            current >>= 5;
        }
        return result + String.fromCharCode(current + 63);
    };

    let lastLat = 0;
    let lastLng = 0;
    let encoded = '';
    for (const point of points) {
        const lat = Math.round(Number(point[0]) * 1e5);
        const lng = Math.round(Number(point[1]) * 1e5);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        encoded += encodeValue(lat - lastLat) + encodeValue(lng - lastLng);
        lastLat = lat;
        lastLng = lng;
    }
    return encoded;
}

/**
 * 均匀采样轨迹点（保留首尾点），最多 `maxPoints` 个。
 * 步长按 `maxPoints - 1` 计算，保证结果不会比上限多出一个点。
 */
export function sampleRoute(points: Array<[number, number]>, maxPoints = MAX_ROUTE_POINTS): Array<[number, number]> {
    if (!Array.isArray(points) || points.length === 0) return [];
    const limit = Math.max(1, Math.floor(maxPoints));
    if (points.length <= limit) return points;
    if (limit === 1) return [points[0]];
    const step = Math.max(1, Math.ceil((points.length - 1) / (limit - 1)));
    const sampled: Array<[number, number]> = [];
    for (let index = 0; index < points.length; index += step) sampled.push(points[index]);
    const last = points[points.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
}

/** 读取 `/api/v1/activity/{id}/map` 的响应，过滤出合法的 [lat, lng] 点。 */
export function parseMapPoints(data: unknown): Array<[number, number]> {
    const latlngs = (data as { latlngs?: unknown } | null)?.latlngs;
    if (!Array.isArray(latlngs)) return [];
    const points: Array<[number, number]> = [];
    for (const point of latlngs) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const lat = Number(point[0]);
        const lng = Number(point[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        points.push([lat, lng]);
    }
    return points;
}

/** 地图接口响应 -> 编码轨迹；点太少（无法构成折线）时返回 undefined。 */
export function polylineFromMap(data: unknown, maxPoints = MAX_ROUTE_POINTS): string | undefined {
    const points = parseMapPoints(data);
    if (points.length < 2) return undefined;
    return encodePolyline(sampleRoute(points, maxPoints));
}

/**
 * 用上一版 `activities.json` 里的轨迹填充活动（活动本身不重复请求地图）。
 * `full` 为 true 时忽略缓存，全部重新拉取。不修改入参。
 */
export function applyRouteCache(activities: Activity[], cached: Map<string, string>, full = false): Activity[] {
    if (full || cached.size === 0) return activities;
    return activities.map((activity) => {
        if (activity.polyline) return activity;
        const polyline = cached.get(activity.id);
        return polyline ? { ...activity, polyline } : activity;
    });
}

/** 需要补拉轨迹的活动 ID：距离为 0（爬楼等）或已有轨迹的活动不请求地图。 */
export function pendingRouteIds(activities: Array<Pick<Activity, 'id' | 'distance' | 'polyline'>>): string[] {
    return activities.filter((activity) => Number(activity.distance) > 0 && !activity.polyline).map((activity) => activity.id);
}

/** 按自然年切分拉取窗口；intervals.icu 列表接口单次返回上限 500 条，分年拉取更稳。 */
export function yearWindows(fromYear: number, toYear: number): Array<{ oldest: string; newest: string }> {
    const start = Math.min(fromYear, toYear);
    const end = Math.max(fromYear, toYear);
    const windows: Array<{ oldest: string; newest: string }> = [];
    for (let year = start; year <= end; year += 1) windows.push({ oldest: `${year}-01-01`, newest: `${year}-12-31` });
    return windows;
}

/** 按 `start_date_local` 升序排列（同步输出统一用这个顺序）。 */
export function sortActivities(activities: Activity[]): Activity[] {
    return [...activities].sort((left, right) => String(left.start_date_local).localeCompare(String(right.start_date_local)));
}
