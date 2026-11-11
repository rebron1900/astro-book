/**
 * 足迹页 / 活动页右栏的「小成就」：全部从构建期数据里算，不依赖外部接口。
 *
 * 刻意只做「能从现有数据推出来」的成就——geojson 里没有海拔字段，
 * 所以没有「海拔最高」；要做的话得先给标点补高程数据。
 */
import type { FootprintData, FootprintPlace } from './footprint';

export interface FootprintAchievement {
    key: string;
    /** 成就名：最北 / 最南 / 去得最多的省 … */
    label: string;
    /** 主体：地名或省份 */
    value: string;
    /** 一句补充说明 */
    note?: string;
    /** 可点击的成就：点一下把这个标点在地图上聚焦 */
    placeId?: string;
}

/** 两个经纬度之间的直线距离（公里，球面近似） */
export function distanceKm(a: FootprintPlace, b: FootprintPlace): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const formatKm = (km: number) => `${Math.round(km).toLocaleString('zh-CN')} 公里`;

export function buildAchievements(data: FootprintData, elevations: Readonly<Record<string, number>> = {}): FootprintAchievement[] {
    const places = data.places;
    if (places.length === 0) return [];

    /** 极值点：同一个坐标可能命中多个标点，取名字最短的那个更好读 */
    const pick = (compare: (a: FootprintPlace, b: FootprintPlace) => number): FootprintPlace =>
        places.reduce((best, place) => (compare(place, best) > 0 ? place : best), places[0]);

    const north = pick((a, b) => a.lat - b.lat);
    const south = pick((a, b) => b.lat - a.lat);
    const east = pick((a, b) => a.lng - b.lng);
    const west = pick((a, b) => b.lng - a.lng);

    // 省份：按标点数排队，第一名就是「去得最多」
    const provinceCount = new Map<string, number>();
    for (const place of places) provinceCount.set(place.province, (provinceCount.get(place.province) ?? 0) + 1);
    const topProvince = [...provinceCount.entries()].sort((a, b) => b[1] - a[1])[0];

    // 游记最多的地点
    const topPlace = places.reduce((best, place) => (place.articleSlugs.length > best.articleSlugs.length ? place : best), places[0]);

    const achievements: FootprintAchievement[] = [
        { key: 'north', label: '最北到过', value: north.name, note: `北纬 ${north.lat.toFixed(1)}°`, placeId: north.id },
        { key: 'south', label: '最南到过', value: south.name, note: `北纬 ${south.lat.toFixed(1)}°`, placeId: south.id },
        { key: 'east', label: '最东', value: east.name, note: `东经 ${east.lng.toFixed(1)}°`, placeId: east.id },
        { key: 'west', label: '最西', value: west.name, note: `东经 ${west.lng.toFixed(1)}°`, placeId: west.id }
    ];

    if (topProvince) {
        achievements.push({ key: 'province', label: '去得最多的省', value: topProvince[0], note: `${topProvince[1]} 个地方` });
    }

    if (topPlace.articleSlugs.length > 0) {
        achievements.push({ key: 'writer', label: '写得最多的地点', value: topPlace.name, note: `${topPlace.articleSlugs.length} 篇游记`, placeId: topPlace.id });
    }

    const span = distanceKm(south, north);
    if (span > 1) {
        achievements.push({ key: 'span', label: '南北跨度', value: formatKm(span), note: `${south.name} → ${north.name}` });
    }

    // 海拔最高：数据来自 src/data/place-elevations.json（scripts/fetch-elevations.mjs 生成）
    const withElevation = places.filter((place) => typeof elevations[place.name] === 'number');
    if (withElevation.length > 0) {
        const highest = withElevation.reduce((best, place) => (elevations[place.name] > elevations[best.name] ? place : best), withElevation[0]);
        achievements.push({
            key: 'elevation',
            label: '海拔最高',
            value: highest.name,
            note: `${elevations[highest.name].toLocaleString('zh-CN')} 米`,
            placeId: highest.id
        });
    }

    return achievements;
}

export interface FootprintYearBucket {
    year: number;
    /** 该年写了几篇游记 */
    count: number;
}

export interface FootprintProvinceStat {
    province: string;
    /** 该省标点数 */
    places: number;
    /** 该省标点关联的游记数（同一篇重复命中只算一次） */
    articles: number;
}

/**
 * 右栏的分布数据：游记按年份的柱状、省份的地点/游记排行。
 * 运动页侧栏是日历热力图 + 周月年统计，这边就用这两个分布撑起同样的信息密度。
 */
export function buildFootprintSummary(data: FootprintData): { years: FootprintYearBucket[]; provinces: FootprintProvinceStat[] } {
    const yearCount = new Map<number, number>();
    for (const article of data.articles) yearCount.set(article.year, (yearCount.get(article.year) ?? 0) + 1);
    const years = [...yearCount.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year);

    const buckets = new Map<string, { places: number; slugs: Set<string> }>();
    for (const place of data.places) {
        const bucket = buckets.get(place.province) ?? { places: 0, slugs: new Set<string>() };
        bucket.places += 1;
        for (const slug of place.articleSlugs) bucket.slugs.add(slug);
        buckets.set(place.province, bucket);
    }
    const provinces = [...buckets.entries()]
        .map(([province, bucket]) => ({ province, places: bucket.places, articles: bucket.slugs.size }))
        .sort((a, b) => b.places - a.places || b.articles - a.articles || a.province.localeCompare(b.province, 'zh-Hans-CN'));

    return { years, provinces };
}
