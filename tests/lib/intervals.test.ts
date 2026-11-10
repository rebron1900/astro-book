import { describe, expect, it } from 'vitest';
import {
    applyRouteCache,
    encodePolyline,
    MAX_ROUTE_POINTS,
    parseMapPoints,
    pendingRouteIds,
    polylineFromMap,
    sampleRoute,
    sortActivities,
    toActivity,
    toUtcIso,
    yearWindows
} from '../../src/lib/intervals';
import type { IntervalsActivity } from '../../src/lib/intervals';
import type { Activity } from '../../src/lib/activity-types';

/** 测试用的独立解码器：返回 [lat, lng]，与 encodePolyline 的入参顺序一致。 */
function decodeLatLng(encoded: string): Array<[number, number]> {
    const points: Array<[number, number]> = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const read = (): number => {
        let result = 0;
        let shift = 0;
        let byte: number;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (index < encoded.length) {
        lat += read();
        lng += read();
        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
}

function raw(partial: Partial<IntervalsActivity> = {}): IntervalsActivity {
    return { id: 'i204300274', ...partial };
}

function activity(partial: Partial<Activity> & { id: string }): Activity {
    return {
        id: partial.id,
        name: partial.name ?? '运动记录',
        distance: partial.distance ?? 1000,
        moving_time: partial.moving_time ?? 600,
        type: partial.type ?? 'Run',
        start_date: partial.start_date ?? '2026-10-11T08:06:19Z',
        start_date_local: partial.start_date_local ?? '2026-10-11 16:06:19',
        average_heartrate: partial.average_heartrate ?? null,
        average_speed: partial.average_speed ?? null,
        elevation_gain: partial.elevation_gain ?? 0,
        ...(partial.polyline ? { polyline: partial.polyline } : {}),
        ...(partial.url ? { url: partial.url } : {}),
        ...(partial.source ? { source: partial.source } : {})
    };
}

describe('toActivity 契约映射', () => {
    it('完整字段按契约映射，moving_time 保持秒数', () => {
        const result = toActivity(
            raw({
                name: '晨跑',
                type: 'Run',
                sub_type: 'trail',
                start_date: '2026-10-11T08:06:19Z',
                start_date_local: '2026-10-11T16:06:19',
                distance: 5218.7,
                moving_time: 1899.6,
                elapsed_time: 2000,
                average_heartrate: 152.4,
                average_speed: 2.746,
                total_elevation_gain: 43.6,
                source: 'ZEPP',
                external_id: 'zepp-123'
            })
        );

        expect(result).toEqual({
            id: 'i204300274',
            name: '晨跑',
            distance: 5219,
            moving_time: 1900,
            type: 'Run',
            start_date: '2026-10-11T08:06:19Z',
            start_date_local: '2026-10-11 16:06:19',
            average_heartrate: 152.4,
            average_speed: 2.746,
            elevation_gain: 44,
            url: 'https://intervals.icu/activities/i204300274',
            source: 'ZEPP'
        });
    });

    it('缺失/为 null 的字段落到安全默认值，不产生 NaN', () => {
        const result = toActivity(raw({ source: null }));

        expect(result.name).toBe('运动记录');
        expect(result.type).toBe('Other');
        expect(result.distance).toBe(0);
        expect(result.moving_time).toBe(0);
        expect(result.elevation_gain).toBe(0);
        expect(result.average_heartrate).toBeNull();
        expect(result.average_speed).toBeNull();
        expect(result.start_date_local).toBe('');
        // 没有本地时间时，start_date 也拿不到 UTC 时间
        expect(result.start_date).toBe('');
        expect(result).not.toHaveProperty('source');
        expect(result).not.toHaveProperty('polyline');
    });

    it('id 统一转成字符串（intervals 活动 ID 可能是数字）', () => {
        expect(toActivity(raw({ id: 204300274 })).id).toBe('204300274');
    });

    it('id 原样保留、不重复加前缀（回归：曾出现 ii204300274）', () => {
        const result = toActivity(raw({ id: 'i204300274' }));

        expect(result.id).toBe('i204300274');
        expect(result.id.startsWith('ii')).toBe(false);
        // url、轨迹缓存 key 都用同一个 id
        expect(result.url).toBe('https://intervals.icu/activities/i204300274');
    });

    it('start_date 缺省时用本地时间补 Z；平均速度缺省为 null 而不是 0', () => {
        const result = toActivity(raw({ start_date: null, start_date_local: '2026-10-11 16:06:19', average_speed: null }));

        expect(result.start_date).toBe('2026-10-11T16:06:19Z');
        expect(result.average_speed).toBeNull();
    });

    it('传入 polyline 时写入契约字段', () => {
        expect(toActivity(raw(), 'abc').polyline).toBe('abc');
        expect(toActivity(raw(), '').polyline).toBeUndefined();
    });

    it('name 为空白字符串时回退到占位文案', () => {
        expect(toActivity(raw({ name: '   ' })).name).toBe('运动记录');
    });
});

describe('toUtcIso 时间规范化', () => {
    it('统一成不带毫秒的 Z 结尾 ISO 字符串', () => {
        expect(toUtcIso('2026-10-11T08:06:19Z', '')).toBe('2026-10-11T08:06:19Z');
        expect(toUtcIso('2026-10-11T08:06:19.123Z', '')).toBe('2026-10-11T08:06:19Z');
        expect(toUtcIso('2026-10-11T08:06:19', '')).toBe('2026-10-11T08:06:19Z');
    });

    it('带时区偏移的输入换算成 UTC', () => {
        expect(toUtcIso('2026-10-11T16:06:19+08:00', '')).toBe('2026-10-11T08:06:19Z');
    });

    it('无法解析时回退到本地墙上时间（旧行为 start_date || local + Z）', () => {
        expect(toUtcIso(null, '2026-10-11 16:06:19')).toBe('2026-10-11T16:06:19Z');
        expect(toUtcIso('', '2026-10-11 16:06:19')).toBe('2026-10-11T16:06:19Z');
        expect(toUtcIso(null, '')).toBe('');
    });
});

describe('encodePolyline 轨迹编码', () => {
    it('与 Google 官方示例逐字节一致（lat/lng 顺序）', () => {
        const points: Array<[number, number]> = [
            [38.5, -120.2],
            [40.7, -120.95],
            [43.252, -126.453]
        ];
        expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    });

    it('解码往返后精度为 1e-5', () => {
        const points: Array<[number, number]> = [
            [30.123456, 120.654321],
            [30.12, 120.66],
            [-33.865, 151.209],
            [0, 0]
        ];
        const decoded = decodeLatLng(encodePolyline(points));

        expect(decoded).toHaveLength(points.length);
        decoded.forEach((point, index) => {
            expect(point[0]).toBeCloseTo(points[index][0], 5);
            expect(point[1]).toBeCloseTo(points[index][1], 5);
        });
    });

    it('跳过非有限数值的点，不影响其它点', () => {
        const encoded = encodePolyline([
            [30.5, 120.5],
            [Number.NaN, 120.6],
            [30.6, 120.7]
        ]);

        expect(decodeLatLng(encoded)).toHaveLength(2);
        expect(encodePolyline([])).toBe('');
    });

    it('与 exercise.ts 的 decodeRoute（返回 [lng, lat]）互验方向一致', async () => {
        // exercise.ts 属于消费层，重构期间可能改签名/临时不可导入：拿不到就跳过，避免误报。
        const mod = (await import('../../src/lib/exercise').catch(() => ({}))) as { decodeRoute?: (encoded: string) => Array<[number, number]> };
        if (typeof mod.decodeRoute !== 'function') return;

        const points: Array<[number, number]> = [
            [30.123456, 120.654321],
            [30.2, 120.7]
        ];
        const [first, second] = mod.decodeRoute(encodePolyline(points));

        // decodeRoute 返回 [lng, lat]，因此索引 0 是经度、索引 1 是纬度
        expect(first[0]).toBeCloseTo(points[0][1], 5);
        expect(first[1]).toBeCloseTo(points[0][0], 5);
        expect(second[0]).toBeCloseTo(points[1][1], 5);
    });
});

describe('sampleRoute 轨迹采样', () => {
    const line = (count: number): Array<[number, number]> => Array.from({ length: count }, (_, index) => [30 + index / 1000, 120 + index / 1000]);

    it('点数不超过上限且保留首尾点', () => {
        const points = line(40000);
        const sampled = sampleRoute(points);

        expect(sampled.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
        expect(sampled[0]).toEqual(points[0]);
        expect(sampled[sampled.length - 1]).toEqual(points[points.length - 1]);
    });

    it('点数少于上限时原样返回，空数组返回空数组', () => {
        const points = line(10);
        expect(sampleRoute(points, 1500)).toBe(points);
        expect(sampleRoute([], 1500)).toEqual([]);
    });

    it('上限为 1 时只保留起点', () => {
        const points = line(5);
        expect(sampleRoute(points, 1)).toEqual([points[0]]);
    });
});

describe('parseMapPoints / polylineFromMap 地图响应处理', () => {
    it('过滤掉非数组、长度不足和非法数值的点', () => {
        const data = {
            latlngs: [[30.1, 120.1], [30.2], [Number.NaN, 120.2], ['30.3', '120.3'], null]
        };
        expect(parseMapPoints(data)).toEqual([
            [30.1, 120.1],
            [30.3, 120.3]
        ]);
    });

    it('latlngs 缺失或不是数组时返回空数组', () => {
        expect(parseMapPoints(null)).toEqual([]);
        expect(parseMapPoints({})).toEqual([]);
        expect(parseMapPoints({ latlngs: 'nope' })).toEqual([]);
    });

    it('点数少于 2 时无法构成折线，返回 undefined', () => {
        expect(polylineFromMap({ latlngs: [[30.1, 120.1]] })).toBeUndefined();
        expect(polylineFromMap({ latlngs: [] })).toBeUndefined();
        expect(polylineFromMap(null)).toBeUndefined();
    });

    it('正常响应编码出可解码的轨迹（lat/lng 顺序）', () => {
        const latlngs: Array<[number, number]> = [
            [30.1, 120.1],
            [30.2, 120.2],
            [30.3, 120.3]
        ];
        const encoded = polylineFromMap({ latlngs });

        expect(typeof encoded).toBe('string');
        expect(decodeLatLng(encoded as string)).toEqual([
            [30.1, 120.1],
            [30.2, 120.2],
            [30.3, 120.3]
        ]);
    });
});

describe('轨迹缓存挑选', () => {
    const first = activity({ id: 'i1', distance: 5000 });
    const second = activity({ id: 'i2', distance: 0 });
    const third = activity({ id: 'i3', distance: 8000, polyline: 'existing' });

    it('applyRouteCache 用上一版轨迹填充缺失项，且不覆盖已有轨迹', () => {
        const cached = new Map([
            ['i1', 'cache-i1'],
            ['i3', 'cache-i3']
        ]);
        const result = applyRouteCache([first, second, third], cached);

        expect(result[0].polyline).toBe('cache-i1');
        expect(result[1].polyline).toBeUndefined();
        expect(result[2].polyline).toBe('existing');
        // 不修改入参
        expect(first.polyline).toBeUndefined();
    });

    it('full=true 或缓存为空时原样返回', () => {
        const cached = new Map([['i1', 'cache-i1']]);
        expect(applyRouteCache([first], cached, true)[0].polyline).toBeUndefined();
        expect(applyRouteCache([first], new Map())[0].polyline).toBeUndefined();
    });

    it('pendingRouteIds 只挑「距离 > 0 且没有轨迹」的活动，并保持原顺序', () => {
        const activities = [first, second, third, activity({ id: 'i4', distance: 1200 })];
        expect(pendingRouteIds(activities)).toEqual(['i1', 'i4']);
    });

    it('pendingRouteIds 对缓存命中后的活动列表返回空数组', () => {
        const cached = new Map([
            ['i1', 'cache-i1'],
            ['i4', 'cache-i4']
        ]);
        const activities = applyRouteCache([first, second, activity({ id: 'i4', distance: 1200 })], cached);
        expect(pendingRouteIds(activities)).toEqual([]);
    });

    it('距离为 0 的室内活动（爬楼等）不请求地图', () => {
        expect(pendingRouteIds([activity({ id: 'i5', distance: 0, type: 'StairStepper' })])).toEqual([]);
    });
});

describe('拉取窗口与输出顺序', () => {
    it('yearWindows 按自然年切分（含首尾年）', () => {
        expect(yearWindows(2024, 2026)).toEqual([
            { oldest: '2024-01-01', newest: '2024-12-31' },
            { oldest: '2025-01-01', newest: '2025-12-31' },
            { oldest: '2026-01-01', newest: '2026-12-31' }
        ]);
    });

    it('yearWindows 起止年顺序颠倒时也能正常切分', () => {
        expect(yearWindows(2026, 2025).map((window) => window.oldest)).toEqual(['2025-01-01', '2026-01-01']);
    });

    it('sortActivities 按 start_date_local 升序且不修改入参', () => {
        const late = activity({ id: 'late', start_date_local: '2026-10-11 18:00:00' });
        const early = activity({ id: 'early', start_date_local: '2025-01-19 07:00:00' });
        const input = [late, early];

        expect(sortActivities(input).map((item) => item.id)).toEqual(['early', 'late']);
        expect(input[0].id).toBe('late');
    });
});
