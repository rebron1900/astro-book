import type { StravaActivity } from './strava-types';
import { estimateCalories } from './exercise';

export type SportKey = 'run' | 'ride' | 'walk' | 'hike' | 'climb' | 'swim' | 'other';

export function sportKey(type: string): SportKey {
    const value = type.toLowerCase();
    if (value.includes('ride') || value.includes('bike') || value.includes('cycle')) return 'ride';
    if (value.includes('run')) return 'run';
    if (value.includes('hike')) return 'hike';
    if (value.includes('walk')) return 'walk';
    if (value.includes('climb')) return 'climb';
    if (value.includes('swim')) return 'swim';
    return 'other';
}

export function formatPace(speed?: number | null) {
    if (!speed || speed <= 0) return null;
    const secondsPerKm = 1000 / speed;
    const minutes = Math.floor(secondsPerKm / 60);
    const seconds = Math.round(secondsPerKm % 60);
    return `${minutes}'${String(seconds).padStart(2, '0')}"/km`;
}

export function formatSpeed(speed?: number | null) {
    if (!speed || speed <= 0) return null;
    return `${(speed * 3.6).toFixed(1)} km/h`;
}

/** "0:31:53" -> 秒 */
function movingSeconds(value: string): number {
    const parts = value.split(':').map((part) => Number(part) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] ?? 0;
}

export function stravaMetaFor(activity: StravaActivity): { key: SportKey; label: string; stats: Array<{ label: string; value: string; primary?: boolean }> } {
    const key = sportKey(activity.type);
    const distance = { label: '距离', value: `${(activity.distance / 1000).toFixed(2)} km` };
    const duration = { label: '用时', value: activity.moving_time.replace(/^0:/, '') };
    const elevation = { label: '爬升', value: `${Math.round(activity.elevation_gain ?? 0)} m` };
    const heartrate = activity.average_heartrate ? { label: '心率', value: `${Math.round(activity.average_heartrate)} bpm` } : null;
    let stats: Array<{ label: string; value: string; primary?: boolean }> = [];

    if (key === 'run') {
        const pace = formatPace(activity.average_speed);
        stats = [distance];
        if (pace) stats.push({ label: '配速', value: pace, primary: true });
        stats.push(duration, elevation);
    } else if (key === 'ride') {
        const speed = formatSpeed(activity.average_speed);
        stats = [distance];
        if (speed) stats.push({ label: '均速', value: speed, primary: true });
        stats.push(duration, elevation);
    } else if (key === 'walk') {
        const pace = formatPace(activity.average_speed);
        stats = [distance, duration];
        if (pace) stats.push({ label: '配速', value: pace, primary: true });
        stats.push(elevation);
    } else if (key === 'hike') {
        stats = [distance, { ...elevation, primary: true }, duration];
    } else if (key === 'climb') {
        stats = [duration, { ...elevation, primary: true }, distance];
    } else if (key === 'swim') {
        const pace = formatPace(activity.average_speed);
        stats = [distance];
        if (pace) stats.push({ label: '配速', value: pace, primary: true });
        stats.push(duration);
    } else {
        stats = [distance, duration, elevation];
    }

    if (heartrate) stats.push(heartrate);
    const calories = estimateCalories(key, movingSeconds(activity.moving_time));
    if (calories > 0) stats.push({ label: '消耗', value: `${calories} kcal` });
    const labels: Record<SportKey, string> = { run: '跑步', ride: '骑行', walk: '步行', hike: '徒步', climb: '攀岩', swim: '游泳', other: '运动' };
    return { key, label: labels[key], stats };
}

export function decodePolyline(encoded: string) {
    let index = 0;
    let lat = 0;
    let lng = 0;
    const points: Array<[number, number]> = [];
    while (index < encoded.length) {
        let result = 0;
        let shift = 0;
        let byte: number;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += result & 1 ? ~(result >> 1) : result >> 1;
        result = 0;
        shift = 0;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lng += result & 1 ? ~(result >> 1) : result >> 1;
        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
}

/**
 * 轨迹缩略图（620×120 的 SVG path）。
 * `maxPoints` 用于列表页这类「一条记录一张小图」的场景：点太多会把 HTML 撑大，
 * 采样到 50 来个点视觉上几乎没差别；`precision` 是坐标小数位。
 */
export function routeSketch(encoded: string | undefined, options: { maxPoints?: number; precision?: number } = {}) {
    if (!encoded) return null;
    const { maxPoints = 0, precision = 1 } = options;
    let points = decodePolyline(encoded);
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
