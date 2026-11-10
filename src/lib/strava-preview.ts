/**
 * 运动卡片的数据整形与轨迹缩略图。
 *
 * 数据来自 `Activity`（intervals.icu 同步结果）。模块/组件名里的「strava」是历史命名，
 * 对应的是这套卡片视觉（strava-cards / /timeline/strava），不再代表数据来源。
 */
import type { Activity } from './activity-types';
import type { MetricIconKind } from './metric-icons';
import { decodeRoute, estimateCalories, formatDuration, formatPaceFromSpeed, formatSpeed, parseDuration, sportOf } from './exercise';
import type { SportKey } from './exercise';

export type { SportKey } from './exercise';

/** 运动类型 -> 卡片主题（与运动页共用同一套映射，stair 也在内） */
export function sportKey(type: string): SportKey {
    return sportOf(type);
}

/** 卡片里的一项指标：`kind` 决定前面显示哪枚小图标（见 `src/lib/metric-icons.ts`） */
export interface StravaStat {
    label: string;
    value: string;
    primary?: boolean;
    kind: MetricIconKind;
}

export function stravaMetaFor(activity: Activity): { key: SportKey; label: string; stats: StravaStat[] } {
    const key = sportKey(activity.type);
    const distance: StravaStat = { label: '距离', value: `${(activity.distance / 1000).toFixed(2)} km`, kind: 'distance' };
    const duration: StravaStat = { label: '用时', value: formatDuration(activity.moving_time), kind: 'duration' };
    const elevation: StravaStat = { label: '爬升', value: `${Math.round(activity.elevation_gain ?? 0)} m`, kind: 'elevation' };
    const heartrate: StravaStat | null = activity.average_heartrate
        ? { label: '心率', value: `${Math.round(activity.average_heartrate)} bpm`, kind: 'heartrate' }
        : null;
    let stats: StravaStat[] = [];

    if (key === 'run') {
        const pace = formatPaceFromSpeed(activity.average_speed);
        stats = [distance];
        if (pace) stats.push({ label: '配速', value: pace, primary: true, kind: 'pace' });
        stats.push(duration, elevation);
    } else if (key === 'ride') {
        const speed = formatSpeed(activity.average_speed);
        stats = [distance];
        if (speed) stats.push({ label: '均速', value: speed, primary: true, kind: 'speed' });
        stats.push(duration, elevation);
    } else if (key === 'walk') {
        const pace = formatPaceFromSpeed(activity.average_speed);
        stats = [distance, duration];
        if (pace) stats.push({ label: '配速', value: pace, primary: true, kind: 'pace' });
        stats.push(elevation);
    } else if (key === 'hike') {
        stats = [distance, { ...elevation, primary: true }, duration];
    } else if (key === 'climb') {
        stats = [duration, { ...elevation, primary: true }, distance];
    } else if (key === 'swim') {
        const pace = formatPaceFromSpeed(activity.average_speed);
        stats = [distance];
        if (pace) stats.push({ label: '配速', value: pace, primary: true, kind: 'pace' });
        stats.push(duration);
    } else {
        stats = [distance, duration, elevation];
    }

    if (heartrate) stats.push(heartrate);
    const calories = estimateCalories(key, parseDuration(activity.moving_time));
    if (calories > 0) stats.push({ label: '消耗', value: `${calories} kcal`, kind: 'calories' });
    const labels: Record<SportKey, string> = { run: '跑步', ride: '骑行', walk: '步行', hike: '徒步', climb: '攀岩', swim: '游泳', stair: '爬楼', other: '运动' };
    return { key, label: labels[key], stats };
}

/**
 * 轨迹缩略图（620×120 的 SVG path）。
 * `maxPoints` 用于列表页这类「一条记录一张小图」的场景：点太多会把 HTML 撑大，
 * 采样到 50 来个点视觉上几乎没差别；`precision` 是坐标小数位。
 */
export function routeSketch(encoded: string | undefined, options: { maxPoints?: number; precision?: number } = {}) {
    if (!encoded) return null;
    const { maxPoints = 0, precision = 1 } = options;
    // decodeRoute 返回 [lng, lat]，这里统一成 [lat, lng] 供缩略图投影使用
    let points = decodeRoute(encoded).map(([lng, lat]) => [lat, lng] as [number, number]);
    if (maxPoints > 0 && points.length > maxPoints) {
        const step = Math.ceil(points.length / maxPoints);
        const sampled = points.filter((_, index) => index % step === 0);
        const last = points[points.length - 1];
        if (sampled[sampled.length - 1] !== last) sampled.push(last);
        points = sampled;
    }
    if (points.length < 2) return null;
    const width = 620;
    const height = 120;
    const padding = 10;
    const rad = ((Math.PI / 180) * points.reduce((sum, point) => sum + point[0], 0)) / points.length;
    const cos = Math.cos(rad) || 1;
    let xy = points.map(([lat, lng]) => [lng * cos, lat] as [number, number]);
    const rawMinX = Math.min(...xy.map(([x]) => x));
    const rawMaxX = Math.max(...xy.map(([x]) => x));
    const rawMinY = Math.min(...xy.map(([, y]) => y));
    const rawMaxY = Math.max(...xy.map(([, y]) => y));
    if (rawMaxY - rawMinY > (rawMaxX - rawMinX) * 1.15) xy = xy.map(([x, y]) => [y, -x] as [number, number]);
    const xs = xy.map(([x]) => x);
    const ys = xy.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 0.000001);
    const spanY = Math.max(maxY - minY, 0.000001);
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
    const drawWidth = spanX * scale;
    const drawHeight = spanY * scale;
    const offsetX = (width - drawWidth) / 2;
    const offsetY = (height - drawHeight) / 2;
    let projected = xy.map(([x, y]) => [offsetX + (x - minX) * scale, offsetY + (maxY - y) * scale]);
    const initialWidth = spanX * scale;
    const targetWidth = (width - padding * 2) * 0.56;
    if (initialWidth < targetWidth) {
        const rightEdge = offsetX + initialWidth;
        const stretch = targetWidth / initialWidth;
        projected = projected.map(([x, y]) => [rightEdge - (rightEdge - x) * stretch, y]);
    }
    const finalMaxX = Math.max(...projected.map(([x]) => x));
    const shiftX = width - padding - finalMaxX;
    projected = projected.map(([x, y]) => [x + shiftX, y]);
    const path = projected.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(precision)},${y.toFixed(precision)}`).join(' ');
    const [startX, startY] = projected[0];
    const [endX, endY] = projected.at(-1)!;
    return { path, startX, startY, endX, endY };
}
