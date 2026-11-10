/* ==========================================================================
   足迹（走过的地方）数据层：构建期把 Google Maps 的标点数据、Ghost 的游记
   拼成页面数据。这里只做纯数据转换，不碰 DOM，方便单测。
   ========================================================================== */

/** Ghost 里给游记打标的标签前缀：`#地点-羊湖` 表示这篇游记对应「羊湖」这个标点 */
export const PLACE_TAG_PREFIX = '#地点-';

/** 足迹模式由预览地图上的按钮触发，两个岛之间用一个 document 事件通信 */
export const FOOTPRINT_OPEN_EVENT = 'exercise-footprint:open';

/** 标点没有映射到省份时的兜底分组 */
export const UNKNOWN_PROVINCE = '未分组';

/**
 * 地名 → 省份。118 个标点里只有「圣水寺」重名两次（两个真实不同的点，都在四川），
 * 所以映射按地名写、计数按标点算：地图上保留全部 118 个点，不合并同名点。
 * 数据来自 docs/… 之外的原型 `provinces.json`，改归属只改这里一行。
 */
export const PROVINCE_BY_PLACE: Readonly<Record<string, string>> = {
    丽江古城: '云南',
    丽江宋城旅游区: '云南',
    公园1903: '云南',
    南屏街: '云南',
    圆通禅寺: '云南',
    大理古城: '云南',
    昆明斗南花市: '云南',
    正义坊购物中心南馆: '云南',
    洱海: '云南',
    滇池: '云南',
    玉龙雪山国家级风景名胜区: '云南',
    蓝月谷: '云南',
    九子寨: '四川',
    僰王山: '四川',
    冠英街: '四川',
    勒多曼因: '四川',
    合江门: '四川',
    四人同: '四川',
    圣水寺: '四川',
    坞瓦布露营地: '四川',
    大草坝: '四川',
    '天府绿道·锦城绿道': '四川',
    峨眉山: '四川',
    康定情歌广场: '四川',
    张大千美术馆: '四川',
    李庄古镇: '四川',
    瓦屋山: '四川',
    白海子: '四川',
    磨西古镇: '四川',
    笔架山: '四川',
    红海子: '四川',
    观音岩: '四川',
    野马海子: '四川',
    青城后山: '四川',
    飞雾谷: '四川',
    魏明伦碑文馆: '四川',
    龙华山: '四川',
    五台山: '山西',
    园博园餐馆: '广西',
    柳侯公园: '广西',
    柳州立鱼峰风景区: '广西',
    爱民螺蛳粉: '广西',
    银滩公园: '广西',
    马鞍山公园: '广西',
    龙潭公园: '广西',
    东方市: '海南',
    亚龙湾海底世界: '海南',
    儋州市: '海南',
    加井岛: '海南',
    南海海上观音苑: '海南',
    博鳌镇: '海南',
    呀诺达雨林: '海南',
    天涯海角: '海南',
    完美大海客栈: '海南',
    槟榔谷: '海南',
    海口市: '海南',
    海口美兰国际机场: '海南',
    白马井镇: '海南',
    石梅湾旅游度假区: '海南',
    蜈支洲: '海南',
    铜鼓岭: '海南',
    华丽服装批发大市场: '湖南',
    太平老街: '湖南',
    火宫殿: '湖南',
    王府井百货: '湖南',
    韶山市: '湖南',
    张掖市: '甘肃',
    敦煌市: '甘肃',
    月牙泉: '甘肃',
    莫高窟: '甘肃',
    '2015年8月骑行到拉萨': '西藏',
    哲蚌寺: '西藏',
    '大昭寺&八角街': '西藏',
    布达拉宫: '西藏',
    羊湖: '西藏',
    色拉寺: '西藏',
    牛角塘: '贵州',
    遵义会议会址: '贵州',
    二厂文创公园: '重庆',
    十八梯: '重庆',
    千厮门大桥: '重庆',
    地下之城火锅: '重庆',
    山城步道: '重庆',
    悦来国际会议中心: '重庆',
    朝天门: '重庆',
    李子坝站B口: '重庆',
    洋人街: '重庆',
    解放碑: '重庆',
    重庆南山鲜龙井火锅: '重庆',
    重庆国际会议展览中心: '重庆',
    重庆来福士广场: '重庆',
    重庆洪崖洞: '重庆',
    魁星楼: '重庆',
    鹅岭公园: '重庆',
    半坡博物馆: '陕西',
    华山: '陕西',
    华清池: '陕西',
    古城楼: '陕西',
    回民街: '陕西',
    壶口瀑布: '陕西',
    大唐芙蓉园: '陕西',
    大雁塔: '陕西',
    少年的你打卡点: '陕西',
    延安保育院: '陕西',
    延安市: '陕西',
    永兴坊: '陕西',
    秦始皇帝陵博物院: '陕西',
    西安碑林: '陕西',
    钟楼: '陕西',
    黄帝陵: '陕西',
    鼓楼博物馆: '陕西',
    柴达木湖: '青海',
    瞿昙寺: '青海',
    茶卡盐湖: '青海',
    西宁市: '青海',
    青海湖风景名胜区: '青海',
    黑马河乡: '青海'
};

/** 查地名所属省份；没收录的地名归到「未分组」，不吞点也不抛错 */
export function provinceOf(placeName: string): string {
    return PROVINCE_BY_PLACE[placeName] ?? UNKNOWN_PROVINCE;
}

/** 省份下的一级子项：一个地名（同名点会合并成一行，但 points 如实计数） */
export interface FootprintProvincePlace {
    name: string;
    /** 该地名对应的标点数（同名点多于一个时 > 1） */
    points: number;
    /** 其中写过游记的标点数 */
    articles: number;
}

/** 两级筛选的一级：省份 + 它下面的地名 */
export interface FootprintProvinceGroup {
    province: string;
    /** 该省标点总数（按点计，不按地名去重） */
    points: number;
    places: FootprintProvincePlace[];
}

/**
 * 把标点按省份组织成两级树，构建期算一次。
 * 排序：标点多的省在前，省内地名按中文拼音序。
 */
export function groupPlacesByProvince(places: readonly FootprintPlace[]): FootprintProvinceGroup[] {
    const buckets = new Map<string, FootprintProvincePlace[]>();
    const totals = new Map<string, number>();

    for (const place of places) {
        const province = place.province;
        totals.set(province, (totals.get(province) ?? 0) + 1);
        const list = buckets.get(province);
        const node = list?.find((item) => item.name === place.name);
        if (node) {
            node.points += 1;
            if (place.articleSlugs.length > 0) node.articles += 1;
        } else if (list) {
            list.push({ name: place.name, points: 1, articles: place.articleSlugs.length > 0 ? 1 : 0 });
        } else {
            buckets.set(province, [{ name: place.name, points: 1, articles: place.articleSlugs.length > 0 ? 1 : 0 }]);
        }
    }

    return [...buckets.entries()]
        .map(([province, list]) => ({
            province,
            points: totals.get(province) ?? list.length,
            places: list.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
        }))
        .sort((a, b) => b.points - a.points || a.province.localeCompare(b.province, 'zh-Hans-CN'));
}

/**
 * 给时间线打「同日重复」标记：只有跟上一篇同一发布日期（完整 YYYY.MM.DD，
 * 跨年不会误判）才算重复，第一行永远不算。
 * 抽成纯函数是为了单测——真实数据里目前没有同日文章，光看界面测不到。
 */
export function markRepeatArticles(articles: readonly Pick<FootprintArticle, 'dateLabel'>[]): boolean[] {
    return articles.map((article, index) => index > 0 && articles[index - 1]?.dateLabel === article.dateLabel);
}

/** 选中集合为空表示「不过滤」，全部显示 */
export function placeMatchesSelection(place: Pick<FootprintPlace, 'name'>, selected: ReadonlySet<string>): boolean {
    return selected.size === 0 || selected.has(place.name);
}

/** 时间线筛选：选中集合为空时全部保留，否则只留命中已选地名的游记 */
export function articleMatchesSelection(article: Pick<FootprintArticle, 'placeNames'>, selected: ReadonlySet<string>): boolean {
    if (selected.size === 0) return true;
    return article.placeNames.some((name) => selected.has(name));
}

/** GeoJSON 里一个标点最少需要的信息（其余字段忽略） */
export interface FootprintFeature {
    properties?: {
        name?: string | null;
        [key: string]: unknown;
    };
    geometry?: {
        type?: string;
        /** Point 是 [lng, lat]；其它几何暂时用不到 */
        coordinates?: unknown;
    };
}

/** Ghost 文章里用得到的字段（宽类型收窄，避免把整个 Ghost Post 拖进这个模块） */
export interface FootprintPost {
    slug: string;
    title: string;
    published_at: string;
    excerpt?: string | null;
    feature_image?: string | null;
    html?: string | null;
    tags?: Array<{ name?: string | null; slug?: string | null }> | null;
}

/** 地图上的一个标点 */
export interface FootprintPlace {
    id: string;
    name: string;
    lng: number;
    lat: number;
    /** 匹配到的游记 slug，按发布时间从新到旧 */
    articleSlugs: string[];
    /** 标记头像用的封面图（取最新一篇带图的游记） */
    cover: string | null;
    /** 归一化后的地名，用于和标签匹配 / 单测 */
    normalized: string;
    /** 所属省份（来自 PROVINCE_BY_PLACE，没收录时为「未分组」） */
    province: string;
}

/** 时间线上的一张游记卡片 */
export interface FootprintArticle {
    slug: string;
    title: string;
    url: string;
    /** ISO 时间串，排序用 */
    date: string;
    /** 展示用：2026.11.02 */
    dateLabel: string;
    year: number;
    excerpt: string;
    images: string[];
    /** 这篇游记命中的标点（顺序跟随标点表） */
    placeIds: string[];
    placeNames: string[];
    /** 游记上所有 `#地点-` 标签的值（包含还没落到标点上的，例如「太原」） */
    tags: string[];
    /** 这些标签还没能在标点表里找到对应地点，展示时可做成不可点的提示 */
    unmatchedTags: string[];
}

export interface FootprintStats {
    /** 标点总数 */
    places: number;
    /** 带 `#地点-` 标签的游记数 */
    articles: number;
    /** 命中了游记的标点数 */
    matchedPlaces: number;
    /** 游记覆盖的年份区间，没有游记时为 null */
    years: [number, number] | null;
}

export interface FootprintData {
    places: FootprintPlace[];
    articles: FootprintArticle[];
    stats: FootprintStats;
}

/** 每张卡片最多展示几张图（memos 卡片也是先展示一小条） */
const MAX_IMAGES = 3;
/** 卡片正文最多保留多少字，超出截断 */
const MAX_EXCERPT = 180;
/** 小于这个长度的地名不参与「前缀命中」，避免一个字的标签乱匹配 */
const MIN_PREFIX_LENGTH = 2;

const IMAGE_PATTERN = /<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;

/**
 * 地名归一化：全半角、大小写、空格和各种标点都会影响匹配，先统一掉。
 * 例：`大昭寺&八角街` / `大昭寺＆八角街` / `大昭寺 & 八角街` 归一化后一致。
 */
export function normalizePlaceName(value: string): string {
    return value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        .replace(/[·・•\-—_&/\\、,，.。:：;"'“”‘’()（）[\]【】《》<>!！?？]/g, '');
}

/** 从 Ghost 标签名里拆出地名；不是 `#地点-` 标签返回 null */
export function parsePlaceTag(tagName: string): string | null {
    if (!tagName.startsWith(PLACE_TAG_PREFIX)) return null;
    const value = tagName.slice(PLACE_TAG_PREFIX.length).trim();
    return value.length > 0 ? value : null;
}

/** 取一篇游记上的全部地点标签（保留原始写法，用于展示） */
export function placeTagsOf(post: Pick<FootprintPost, 'tags'>): string[] {
    const tags: string[] = [];
    for (const tag of post.tags ?? []) {
        const name = tag?.name;
        if (!name) continue;
        const value = parsePlaceTag(name);
        if (value) tags.push(value);
    }
    return tags;
}

/**
 * 把一个地名和一组地点标签对上号。
 *
 * 规则从紧到松：
 * 1. 归一化后完全相等；
 * 2. 地名以标签开头（`康定情歌广场` ← `康定`），或标签以地名开头（`五台山风景区` ← `五台山`）。
 * 模糊匹配只在短的一侧长度 ≥ 2 时生效，并且多命中时取最长的一侧。
 */
export function matchPlaceTag(placeName: string, tags: readonly string[]): string | null {
    const normalized = normalizePlaceName(placeName);
    if (!normalized) return null;

    let best: string | null = null;
    let bestLength = 0;
    for (const tag of tags) {
        const key = normalizePlaceName(tag);
        if (!key) continue;
        if (key === normalized) return tag;
        if (key.length < MIN_PREFIX_LENGTH) continue;
        const hit = normalized.startsWith(key) || key.startsWith(normalized);
        if (!hit) continue;
        if (key.length > bestLength) {
            best = tag;
            bestLength = key.length;
        }
    }
    return best;
}

/** 从 Ghost 文章的 html 里抽图片：封面优先，然后按正文顺序补，去重且不超过 3 张 */
export function extractPostImages(post: Pick<FootprintPost, 'feature_image' | 'html'>): string[] {
    const images: string[] = [];
    const push = (raw: string | null | undefined) => {
        if (!raw) return;
        const src = raw.trim();
        if (!src || images.includes(src)) return;
        // 正文里的懒加载占位、图标之类的就不进卡片了
        if (/^(data:|blob:)/i.test(src)) return;
        images.push(src);
    };

    push(post.feature_image ?? null);
    const html = post.html ?? '';
    for (const match of html.matchAll(IMAGE_PATTERN)) {
        push(match[1] ?? match[2]);
        if (images.length >= MAX_IMAGES) break;
    }
    return images.slice(0, MAX_IMAGES);
}

/** 摘要清洗：去标签、压空白、截断到卡片能放下的长度 */
export function toExcerpt(value: string | null | undefined, maxLength = MAX_EXCERPT): string {
    if (!value) return '';
    const text = value.replace(HTML_TAG_PATTERN, ' ').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trimEnd()}…`;
}

function formatDateLabel(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}.${month}.${day}`;
}

function readPointCoordinates(feature: FootprintFeature): [number, number] | null {
    const geometry = feature.geometry;
    // 标点只认 Point；线/面要素的坐标是嵌套数组，不能当作经纬度用
    if (geometry?.type && geometry.type !== 'Point') return null;
    const coordinates = geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const [lng, lat] = coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number') return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat];
}

/**
 * 构建足迹页数据。
 *
 * - 标点来自 `src/data/geojson.json`（Google Maps 导出）；
 * - 文章来自 Ghost：只收集带 `#地点-` 标签的文章，标签值直接当地名匹配；
 * - 一张游记可以覆盖多个标点，一个标点也可以挂多篇游记（按时间从新到旧）。
 */
export function buildFootprint(features: readonly FootprintFeature[], posts: readonly FootprintPost[]): FootprintData {
    const places: FootprintPlace[] = [];
    const seenIds = new Set<string>();

    for (const [index, feature] of features.entries()) {
        const name = feature.properties?.name?.trim();
        const point = readPointCoordinates(feature);
        if (!name || !point) continue;
        const id = `fp-${index}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        places.push({
            id,
            name,
            lng: point[0],
            lat: point[1],
            articleSlugs: [],
            cover: null,
            normalized: normalizePlaceName(name),
            province: provinceOf(name)
        });
    }

    // 先按时间从新到旧处理文章：这样标点的封面天然取最新一篇的图
    const tagged = posts
        .map((post) => ({ post, tags: placeTagsOf(post), date: Date.parse(post.published_at) }))
        .filter((entry) => entry.tags.length > 0)
        .filter((entry) => Number.isFinite(entry.date))
        .sort((a, b) => b.date - a.date);

    const articles: FootprintArticle[] = [];
    for (const { post, tags, date } of tagged) {
        const placeIds: string[] = [];
        const placeNames: string[] = [];
        const matchedTags = new Set<string>();
        for (const place of places) {
            const hit = matchPlaceTag(place.name, tags);
            if (!hit) continue;
            matchedTags.add(hit);
            placeIds.push(place.id);
            placeNames.push(place.name);
        }

        // 地方已经出现的标点顺序跟随标点表，而不是标签书写顺序
        const images = extractPostImages(post);
        const published = new Date(date);
        const article: FootprintArticle = {
            slug: post.slug,
            title: post.title,
            url: `/${post.slug}/`,
            date: published.toISOString(),
            dateLabel: formatDateLabel(published),
            year: published.getFullYear(),
            excerpt: toExcerpt(post.excerpt),
            images,
            placeIds,
            placeNames,
            tags,
            unmatchedTags: tags.filter((tag) => !matchedTags.has(tag))
        };
        articles.push(article);

        for (const id of placeIds) {
            const place = places.find((item) => item.id === id);
            if (!place) continue;
            place.articleSlugs.push(post.slug);
            if (!place.cover && images.length > 0) place.cover = images[0];
        }
    }

    const years =
        articles.length > 0 ? ([Math.min(...articles.map((item) => item.year)), Math.max(...articles.map((item) => item.year))] as [number, number]) : null;

    return {
        places,
        articles,
        stats: {
            places: places.length,
            articles: articles.length,
            matchedPlaces: places.filter((place) => place.articleSlugs.length > 0).length,
            years
        }
    };
}
