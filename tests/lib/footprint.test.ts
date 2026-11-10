import { describe, expect, it } from 'vitest';
import {
    articleMatchesSelection,
    buildFootprint,
    extractPostImages,
    groupPlacesByProvince,
    markRepeatArticles,
    matchPlaceTag,
    normalizePlaceName,
    parsePlaceTag,
    placeMatchesSelection,
    placeTagsOf,
    PLACE_TAG_PREFIX,
    PROVINCE_BY_PLACE,
    provinceOf,
    toExcerpt,
    UNKNOWN_PROVINCE
} from '../../src/lib/footprint';
import type { FootprintFeature, FootprintPost } from '../../src/lib/footprint';

function feature(name: string, lng: number, lat: number): FootprintFeature {
    return { properties: { name }, geometry: { type: 'Point', coordinates: [lng, lat] } };
}

function post(overrides: Partial<FootprintPost> & { slug: string; title: string; published_at: string }): FootprintPost {
    return {
        excerpt: '',
        feature_image: null,
        html: '',
        tags: [],
        ...overrides
    };
}

describe('parsePlaceTag', () => {
    it('拆出 #地点- 前缀后的地名', () => {
        expect(parsePlaceTag('#地点-羊湖')).toBe('羊湖');
        expect(parsePlaceTag('#地点- 大昭寺&八角街 ')).toBe('大昭寺&八角街');
    });

    it('不是地点标签时返回 null', () => {
        expect(parsePlaceTag('游记')).toBeNull();
        expect(parsePlaceTag('#相册-徒步')).toBeNull();
        expect(parsePlaceTag(PLACE_TAG_PREFIX)).toBeNull();
    });
});

describe('normalizePlaceName', () => {
    it('忽略空白、全半角与常见标点', () => {
        expect(normalizePlaceName('大昭寺 & 八角街')).toBe(normalizePlaceName('大昭寺&八角街'));
        expect(normalizePlaceName('２０１５年８月骑行到拉萨')).toBe(normalizePlaceName('2015年8月骑行到拉萨'));
        expect(normalizePlaceName('昆明 · 斗南花市')).toBe(normalizePlaceName('昆明斗南花市'));
    });
});

describe('matchPlaceTag', () => {
    it('完全一致优先', () => {
        expect(matchPlaceTag('羊湖', ['布达拉宫', '羊湖'])).toBe('羊湖');
    });

    it('地名以标签开头时也能命中（康定 → 康定情歌广场）', () => {
        expect(matchPlaceTag('康定情歌广场', ['康定'])).toBe('康定');
    });

    it('标签比地名更长时反向命中（五台山风景区 → 五台山）', () => {
        expect(matchPlaceTag('五台山', ['五台山风景区'])).toBe('五台山风景区');
    });

    it('多个前缀同时命中时取更长的那个', () => {
        expect(matchPlaceTag('五台山', ['五台', '五台山'])).toBe('五台山');
    });

    it('单字标签不参与模糊命中', () => {
        expect(matchPlaceTag('羊湖', ['羊'])).toBeNull();
    });

    it('对不上时返回 null', () => {
        expect(matchPlaceTag('太原', ['五台山'])).toBeNull();
    });
});

describe('placeTagsOf', () => {
    it('只保留 #地点- 标签，保留原始地名写法', () => {
        expect(
            placeTagsOf({
                tags: [{ name: '#地点-五台山' }, { name: '#地点-太原' }, { name: '游记' }, { name: '#相册-徒步' }]
            })
        ).toEqual(['五台山', '太原']);
    });

    it('没有标签时返回空数组', () => {
        expect(placeTagsOf({})).toEqual([]);
        expect(placeTagsOf({ tags: null })).toEqual([]);
    });
});

describe('extractPostImages', () => {
    it('封面在前，正文图片按顺序补齐并去重', () => {
        const images = extractPostImages({
            feature_image: 'https://cdn.example.com/cover.jpg',
            html: '<p><img src="https://cdn.example.com/a.jpg" /></p><p><img src="https://cdn.example.com/cover.jpg" /></p><p><img src="https://cdn.example.com/b.jpg" /></p>'
        });
        expect(images).toEqual(['https://cdn.example.com/cover.jpg', 'https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']);
    });

    it('最多返回 3 张，跳过 data: 占位图', () => {
        const images = extractPostImages({
            feature_image: null,
            html: '<img src="data:image/gif;base64,xx"><img src="https://cdn.example.com/1.jpg"><img src="https://cdn.example.com/2.jpg"><img src="https://cdn.example.com/3.jpg"><img src="https://cdn.example.com/4.jpg">'
        });
        expect(images).toEqual(['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg', 'https://cdn.example.com/3.jpg']);
    });
});

describe('toExcerpt', () => {
    it('去标签、压空白', () => {
        expect(toExcerpt('<p>第一段</p>\n\n<p>第二段</p>')).toBe('第一段 第二段');
    });

    it('超长时截断并补省略号', () => {
        const text = 'a'.repeat(200);
        expect(toExcerpt(text, 10)).toBe(`${'a'.repeat(10)}…`);
        expect(toExcerpt(null)).toBe('');
    });
});

describe('buildFootprint', () => {
    const features = [feature('羊湖', 90.67, 29.02), feature('五台山', 113.59, 39.01), feature('康定情歌广场', 101.96, 30.05)];

    const posts = [
        post({
            slug: 'zou-da-zhao-tai-wo-zai-xiang-sha-san',
            title: '走大朝台我在想啥？三',
            published_at: '2026-11-02T10:00:00.000+08:00',
            excerpt: '<p>头一晚虽然很累</p>',
            feature_image: 'https://cdn.example.com/cover-3.jpg',
            html: '<img src="https://cdn.example.com/3-a.jpg">',
            tags: [{ name: '#地点-五台山' }, { name: '#地点-太原' }, { name: '游记' }]
        }),
        post({
            slug: 'zou-da-zhao-tai-wo-zai-xiang-sha-yi',
            title: '走大朝台我在想啥？一',
            published_at: '2026-10-22T10:00:00.000+08:00',
            tags: [{ name: '#地点-五台山' }]
        }),
        post({
            slug: 'duan-wu-zai-you-kang-ding',
            title: '端午再游康定+看高山海子',
            published_at: '2025-06-03T10:00:00.000+08:00',
            excerpt: '没想到这个月又来了一次康定。',
            tags: [{ name: '#地点-康定' }, { name: '#地点-白海子' }]
        }),
        post({
            slug: 'no-place-tag',
            title: '没打地点标签的文章',
            published_at: '2026-11-05T10:00:00.000+08:00'
        })
    ];

    const data = buildFootprint(features, posts);

    it('标点保留全部地点并带上坐标', () => {
        expect(data.places.map((place) => place.name)).toEqual(['羊湖', '五台山', '康定情歌广场']);
        expect(data.places[0]).toMatchObject({ lng: 90.67, lat: 29.02 });
    });

    it('只收集带地点标签的文章，并按时间从新到旧', () => {
        expect(data.articles.map((article) => article.slug)).toEqual([
            'zou-da-zhao-tai-wo-zai-xiang-sha-san',
            'zou-da-zhao-tai-wo-zai-xiang-sha-yi',
            'duan-wu-zai-you-kang-ding'
        ]);
    });

    it('一个标点可以挂多篇游记，封面取最新一篇的图', () => {
        const wutai = data.places.find((place) => place.name === '五台山');
        expect(wutai?.articleSlugs).toEqual(['zou-da-zhao-tai-wo-zai-xiang-sha-san', 'zou-da-zhao-tai-wo-zai-xiang-sha-yi']);
        expect(wutai?.cover).toBe('https://cdn.example.com/cover-3.jpg');
    });

    it('前缀匹配让康定落到康定情歌广场；没落地的标签也保留在卡片上', () => {
        const kangding = data.articles.find((article) => article.slug === 'duan-wu-zai-you-kang-ding');
        expect(kangding?.placeNames).toEqual(['康定情歌广场']);
        expect(data.articles[0].tags).toEqual(['五台山', '太原']);
        expect(data.articles[0].placeNames).toEqual(['五台山']);
    });

    it('摘要和图片直接来自文章自身', () => {
        const article = data.articles.find((item) => item.slug === 'duan-wu-zai-you-kang-ding');
        expect(article?.excerpt).toBe('没想到这个月又来了一次康定。');
        expect(article?.images).toEqual([]);
        expect(article?.dateLabel).toBe('2025.06.03');
        expect(article?.url).toBe('/duan-wu-zai-you-kang-ding/');
    });

    it('统计里带上标点数、文章数、命中数和年份范围', () => {
        expect(data.stats).toEqual({ places: 3, articles: 3, matchedPlaces: 2, years: [2025, 2026] });
    });

    it('忽略缺名字、缺坐标或坐标不是 Point 的要素', () => {
        const messy = [feature('', 1, 2), { properties: { name: '坏点' }, geometry: { type: 'LineString', coordinates: [1, 2] } }, feature('好点', 3, 4)];
        expect(buildFootprint(messy, []).places.map((place) => place.name)).toEqual(['好点']);
    });
});

describe('provinces', () => {
    it('映射覆盖全部 117 个唯一地名，且只有这些值', () => {
        expect(Object.keys(PROVINCE_BY_PLACE)).toHaveLength(117);
        const provinces = new Set(Object.values(PROVINCE_BY_PLACE));
        expect([...provinces].sort()).toEqual(['云南', '四川', '山西', '广西', '甘肃', '贵州', '重庆', '陕西', '青海', '西藏', '湖南', '海南'].sort());
    });

    it('没收录的地名归到「未分组」，不会抛错也不会吞点', () => {
        expect(provinceOf('不在表里的地方')).toBe(UNKNOWN_PROVINCE);
        expect(provinceOf('羊湖')).toBe('西藏');
    });

    it('两级树按点计数：两个同名的「圣水寺」算 2 个标点、1 行地名', () => {
        const places = buildFootprint(
            [feature('圣水寺', 105.04, 29.6), feature('圣水寺', 104.98, 31.59), feature('羊湖', 90.67, 29.02)],
            [post({ slug: 'a', title: '羊湖游记', published_at: '2026-01-02T00:00:00Z', tags: [{ name: '#地点-羊湖' }] })]
        ).places;

        const groups = groupPlacesByProvince(places);
        const sichuan = groups.find((group) => group.province === '四川');
        expect(sichuan?.points).toBe(2);
        expect(sichuan?.places).toEqual([{ name: '圣水寺', points: 2, articles: 0 }]);

        const tibet = groups.find((group) => group.province === '西藏');
        expect(tibet?.places).toEqual([{ name: '羊湖', points: 1, articles: 1 }]);

        // 合计按点算，不按地名去重
        expect(groups.reduce((sum, group) => sum + group.points, 0)).toBe(places.length);
    });

    it('一级分组按标点数从多到少排，省内地名按拼音序', () => {
        const places = buildFootprint([feature('圣水寺', 105.04, 29.6), feature('羊湖', 90.67, 29.02), feature('布达拉宫', 91.11, 29.65)], []).places;
        const groups = groupPlacesByProvince(places);
        expect(groups.map((group) => group.province)).toEqual(['西藏', '四川']);
        expect(groups[0].places.map((place) => place.name)).toEqual(['布达拉宫', '羊湖']);
    });
});

describe('selection', () => {
    const places = buildFootprint([feature('圣水寺', 105.04, 29.6), feature('圣水寺', 104.98, 31.59), feature('羊湖', 90.67, 29.02)], []).places;

    it('空集合表示不过滤', () => {
        const empty = new Set<string>();
        expect(places.every((place) => placeMatchesSelection(place, empty))).toBe(true);
        expect(articleMatchesSelection({ placeNames: ['羊湖'] }, empty)).toBe(true);
    });

    it('按地名选中时同名点一起命中', () => {
        expect(places.filter((place) => placeMatchesSelection(place, new Set(['圣水寺'])))).toHaveLength(2);
        expect(articleMatchesSelection({ placeNames: ['羊湖'] }, new Set(['圣水寺']))).toBe(false);
        expect(articleMatchesSelection({ placeNames: ['羊湖'] }, new Set(['圣水寺', '羊湖']))).toBe(true);
    });
});

describe('markRepeatArticles', () => {
    it('同一发布日期算重复，第一行永远不重复', () => {
        expect(markRepeatArticles([{ dateLabel: '2026.11.02' }, { dateLabel: '2026.11.02' }, { dateLabel: '2026.10.23' }])).toEqual([false, true, false]);
    });

    it('月日相同但年份不同不算重复（跨年边界）', () => {
        expect(markRepeatArticles([{ dateLabel: '2025.05.18' }, { dateLabel: '2024.05.18' }])).toEqual([false, false]);
    });

    it('空列表不报错', () => {
        expect(markRepeatArticles([])).toEqual([]);
    });
});
