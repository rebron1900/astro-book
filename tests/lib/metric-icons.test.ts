import { describe, it, expect } from 'vitest';
import { METRIC_ICONS, metricIconHtml } from '../../src/lib/metric-icons';
import type { MetricIconKind } from '../../src/lib/metric-icons';
import { stravaMetaFor } from '../../src/lib/strava-preview';
import type { Activity } from '../../src/lib/activity-types';

const KINDS = Object.keys(METRIC_ICONS) as MetricIconKind[];

/** 只允许 lucide 风格的几何子标签，避免某条路径写错把整块 SVG 弄坏 */
const ALLOWED_TAGS = /^<(path|circle|line|rect|polyline|polygon)\b/;

function activity(partial: Partial<Activity> = {}): Activity {
    return {
        id: 'i1',
        name: 'Morning Run',
        distance: 5000,
        moving_time: 1500,
        type: 'Run',
        start_date: '2026-10-11T07:00:00Z',
        start_date_local: '2026-10-11 07:00:00',
        average_speed: 3.33,
        average_heartrate: 150,
        elevation_gain: 42,
        ...partial
    };
}

describe('指标图标字典', () => {
    it('每个指标都有非空的 SVG 片段', () => {
        expect(KINDS.length).toBeGreaterThanOrEqual(10);
        for (const kind of KINDS) {
            expect(METRIC_ICONS[kind].trim().length).toBeGreaterThan(0);
        }
    });

    it('片段只包含允许的几何标签且标签闭合', () => {
        for (const kind of KINDS) {
            const markup = METRIC_ICONS[kind];
            const tags = markup.match(/<[a-z]+/g) ?? [];
            expect(tags.length, kind).toBeGreaterThan(0);
            for (const tag of tags) expect(tag, kind).toMatch(ALLOWED_TAGS);

            const opened = (markup.match(/<(path|circle|line|rect|polyline|polygon)\b/g) ?? []).length;
            const closed = (markup.match(/\/>/g) ?? []).length;
            expect(closed, kind).toBe(opened);
        }
    });

    it('metricIconHtml 输出带统一装饰属性的 svg', () => {
        const html = metricIconHtml('distance');
        expect(html).toContain('<svg class="metric-icon"');
        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain('stroke="currentColor"');
        expect(html).toContain(METRIC_ICONS.distance);
        expect(metricIconHtml('pace', 'custom-icon')).toContain('class="custom-icon"');
    });
});

describe('运动卡片指标与图标对应', () => {
    const cases: Array<[string, string]> = [
        ['Run', 'run'],
        ['Ride', 'ride'],
        ['Walk', 'walk'],
        ['Hike', 'hike'],
        ['RockClimbing', 'climb'],
        ['Swim', 'swim'],
        ['Workout', 'other']
    ];

    // 卡片文案 -> 图标，保证改了文案也不会悄悄丢图标
    const EXPECTED: Record<string, MetricIconKind> = {
        距离: 'distance',
        用时: 'duration',
        爬升: 'elevation',
        配速: 'pace',
        均速: 'speed',
        心率: 'heartrate',
        消耗: 'calories'
    };

    it.each(cases)('%s 的每项指标都带可用图标', (type) => {
        const meta = stravaMetaFor(activity({ type }));
        expect(meta.stats.length).toBeGreaterThan(0);
        for (const stat of meta.stats) {
            expect(EXPECTED[stat.label], `${type} / ${stat.label}`).toBe(stat.kind);
            expect(METRIC_ICONS[stat.kind]).toBeTruthy();
        }
    });

    it('缺少速度与心率时不生成对应指标', () => {
        const meta = stravaMetaFor(activity({ type: 'Run', average_speed: null, average_heartrate: null }));
        const labels = meta.stats.map((stat) => stat.label);
        expect(labels).not.toContain('配速');
        expect(labels).not.toContain('心率');
        expect(labels).toEqual(['距离', '用时', '爬升', '消耗']);
    });
});
