import { describe, expect, it } from 'vitest';
import { buildAchievements, buildFootprintSummary, distanceKm } from '../../src/lib/footprint-achievements';
import type { FootprintData, FootprintPlace } from '../../src/lib/footprint';

const place = (name: string, lng: number, lat: number, province: string, articles = 0): FootprintPlace => ({
    id: name,
    name,
    lng,
    lat,
    articleSlugs: Array.from({ length: articles }, (_, index) => `${name}-${index}`),
    cover: null,
    normalized: name,
    province
});

const data = (places: FootprintPlace[], years: [number, number] | null = [2019, 2026]): FootprintData =>
    ({
        places,
        articles: [],
        stats: { places: places.length, articles: 0, matchedPlaces: 0, years }
    }) as unknown as FootprintData;

describe('buildAchievements', () => {
    it('没有标点时返回空数组', () => {
        expect(buildAchievements(data([]))).toEqual([]);
    });

    it('东南西北取到正确的地名', () => {
        const places = [place('北点', 100, 45, '内蒙古'), place('南点', 105, 20, '海南'), place('东点', 122, 30, '浙江'), place('西点', 90, 32, '西藏')];
        const list = buildAchievements(data(places));
        const pick = (key: string) => list.find((item) => item.key === key)?.value;
        expect(pick('north')).toBe('北点');
        expect(pick('south')).toBe('南点');
        expect(pick('east')).toBe('东点');
        expect(pick('west')).toBe('西点');
    });

    it('省份按标点数排名，游记最多的地点单独一条', () => {
        const places = [place('甲', 100, 30, '四川', 1), place('乙', 101, 30, '四川', 3), place('丙', 102, 30, '云南')];
        const list = buildAchievements(data(places));
        expect(list.find((item) => item.key === 'province')?.value).toBe('四川');
        expect(list.find((item) => item.key === 'province')?.note).toBe('2 个地方');
        expect(list.find((item) => item.key === 'writer')?.value).toBe('乙');
    });

    it('没有游记时不生成「写得最多的地点」', () => {
        const list = buildAchievements(data([place('甲', 100, 30, '四川')]));
        expect(list.some((item) => item.key === 'writer')).toBe(false);
    });

    it('距离计算和南北跨度', () => {
        const a = place('南点', 100, 20, '海南');
        const b = place('北点', 100, 30, '河北');
        expect(distanceKm(a, b)).toBeGreaterThan(1000);
        expect(distanceKm(a, b)).toBeLessThan(1130);
        const list = buildAchievements(data([a, b]));
        expect(list.find((item) => item.key === 'span')?.value).toBe('1,112 公里');
    });

    it('有海拔数据时给出海拔最高的地点', () => {
        const places = [place('低点', 100, 30, '四川'), place('高点', 101, 31, '西藏')];
        const list = buildAchievements(data(places), { 低点: 1200, 高点: 4454 });
        const item = list.find((entry) => entry.key === 'elevation');
        expect(item?.value).toBe('高点');
        expect(item?.note).toBe('4,454 米');
    });

    it('没有海拔数据时不生成海拔成就', () => {
        const list = buildAchievements(data([place('甲', 100, 30, '四川')]));
        expect(list.some((item) => item.key === 'elevation')).toBe(false);
    });
});

describe('buildFootprintSummary', () => {
    it('按年份聚合计数的游记', () => {
        const articles = [
            { year: 2024, slug: 'a' },
            { year: 2024, slug: 'b' },
            { year: 2019, slug: 'c' }
        ];
        const data = { places: [], articles, stats: { places: 0, articles: 3, matchedPlaces: 0, years: null } } as unknown as FootprintData;
        expect(buildFootprintSummary(data).years).toEqual([
            { year: 2019, count: 1, places: [] },
            { year: 2024, count: 2, places: [] }
        ]);
    });

    it('年份桶带上那年去过的地点', () => {
        const articles = [
            { year: 2024, slug: 'a', placeNames: ['青海湖', '西宁'] },
            { year: 2024, slug: 'b', placeNames: ['青海湖'] }
        ];
        const data = { places: [], articles, stats: { places: 0, articles: 2, matchedPlaces: 0, years: null } } as unknown as FootprintData;
        expect(buildFootprintSummary(data).years).toEqual([{ year: 2024, count: 2, places: ['青海湖', '西宁'] }]);
    });

    it('省份按标点数排序，游记去重', () => {
        const a = place('甲', 100, 30, '四川', 2);
        const b = { ...place('乙', 101, 30, '四川', 2) };
        const c = place('丙', 102, 30, '云南', 1);
        const data = { places: [a, b, c], articles: [], stats: { places: 3, articles: 0, matchedPlaces: 0, years: null } } as unknown as FootprintData;
        const provinces = buildFootprintSummary(data).provinces;
        // 两个标点各带 2 篇不同 slug 的游记，并集是 4 篇
        expect(provinces[0]).toEqual({ province: '四川', places: 2, articles: 4, names: ['甲', '乙'] });
        expect(provinces[1].province).toBe('云南');
    });
});
