/**
 * Ghost 内容 → src/data/ghost.json（全站内容源：文章 / 页面 / 作者 / 标签）。
 *
 * 迁移自 scripts/sync-data.mjs 的 syncGhost / trimEntry / trimTagPost / pick，行为逐行保留：
 * 五段一次取全、0 篇拒写、内嵌 tags/authors 裁剪、tags 内嵌「按标签筛过的裁剪版文章」。
 *
 * 传输从 @ts-ghost/content-api 换成执行器的 ctx.fetchJson，原因有两条：
 *  1. 客户端把 HTTP 状态吞成 {success:false}，401/403 无法按 auth 分类（验收要求）；
 *  2. 走 ctx 才能统一拿到超时、跨源跳头与日志脱敏。
 * 请求的参数集合与原客户端一致（page / include=authors,tags / limit=all / order=count.posts+desc），
 * 路径与 query 值逐字保留（参数顺序不敏感：Ghost 不区分键序，新旧实现的键序虽不同但集合相同），
 * 响应体也是 Ghost Content API 原样 JSON，因此产物不变。
 */
export const meta = {
    id: 'ghost',
    optional: false,
    credentials: ['GHOST_API_URL', 'GHOST_API_KEY'],
    optionalCredentials: ['GHOST_API_POST_LIMIT'],
    datasets: ['ghost.content'],
    datasetVersions: { 'ghost.content': 1 },
    description: 'Ghost 内容快照（settings + posts/pages/authors/tags）'
};

// tag 详情页的 posts 列表字段（不含 html，避免 60 个 tag 重复全文）
const TAG_POST_FIELDS = [
    'id', 'slug', 'title', 'excerpt', 'feature_image', 'feature_image_alt', 'feature_image_caption',
    'published_at', 'updated_at', 'created_at', 'reading_time', 'tags', 'type'
];

// Ghost Post/Page 消费字段（页面渲染 + albums/rss/search/toc 等）
const GHOST_ENTRY_FIELDS = [
    'id', 'slug', 'title', 'html', 'excerpt',
    'feature_image', 'feature_image_alt', 'feature_image_caption',
    'published_at', 'updated_at', 'created_at', 'reading_time',
    'tags', 'authors', 'type'
];

// 内嵌 tag 对象消费字段（post.tags / tag 页）
export const TAG_FIELDS = ['id', 'slug', 'name', 'visibility'];

// 内嵌 author 对象消费字段
export const AUTHOR_FIELDS = ['id', 'slug', 'name', 'profile_image', 'cover_image', 'bio'];

/** 字段白名单裁剪（也供全量等价对照复用）。 */
export function pick(obj, fields) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const f of fields) {
        if (f in obj) out[f] = obj[f];
    }
    return out;
}

export function trimTagPost(p) {
    const e = pick(p, TAG_POST_FIELDS);
    if (Array.isArray(e.tags)) e.tags = e.tags.map((t) => pick(t, TAG_FIELDS));
    e.type = 'post';
    return normalizeNullBody(e);
}

/**
 * 真实 Ghost 对「邮件版 / 无正文」条目会返回 html=null、excerpt=null、reading_time=null
 * （2026-11-27 CI 实测 106 处），而契约里 html/excerpt 是 string?、reading_time 是 number?。
 * 落盘统一成既有数据形状：正文与摘要退化为空串（页面本来就按 `?? ''` 消费），
 * 不知道阅读时长就省略该字段（PostMeta 只展示 > 0 的值），不编一个 0。
 */
function normalizeNullBody(e) {
    if (e.html === null) e.html = '';
    if (e.excerpt === null) e.excerpt = '';
    if (e.reading_time === null) delete e.reading_time;
    return e;
}

export function trimEntry(entry, type) {
    const e = pick(entry, GHOST_ENTRY_FIELDS);
    if (Array.isArray(e.tags)) e.tags = e.tags.map((t) => pick(t, TAG_FIELDS));
    if (Array.isArray(e.authors)) e.authors = e.authors.map((a) => pick(a, AUTHOR_FIELDS));
    if (e.primary_author) e.primary_author = pick(e.primary_author, AUTHOR_FIELDS);
    e.type = type;
    return normalizeNullBody(e);
}

/** 内容 API 的 URL 拼装：路径与 query 与原客户端一致（key 放最后，避免日志先打到 key）。 */
function contentUrl(base, resource, query, key) {
    const params = new URLSearchParams(query);
    params.set('key', key);
    return `${base.replace(/\/$/, '')}/ghost/api/content/${resource}/?${params.toString()}`;
}

/** 按 Ghost 的分页元数据逐页拉，直到没有 next 或已达上限。 */
async function browse(ctx, base, resource, query, pickList, limit = Infinity) {
    const rows = [];
    let page = 1;
    for (;;) {
        const body = await ctx.fetchJson(contentUrl(base, resource, { ...query, page: String(page) }, ctx.env.GHOST_API_KEY), {}, 30000);
        const list = pickList(body);
        if (!Array.isArray(list)) throw new Error(`[ghost] ${resource} 第 ${page} 页响应缺少数组`);
        rows.push(...list);
        const next = Number(body?.meta?.pagination?.next || 0);
        if (!next || rows.length >= limit) break;
        page = next;
    }
    return limit === Infinity ? rows : rows.slice(0, limit);
}

export async function collect(ctx) {
    const base = ctx.env.GHOST_API_URL;
    const postLimit = parseInt(ctx.env.GHOST_API_POST_LIMIT || '9999', 10);
    const includeAuthorsTags = { include: 'authors,tags' };

    // settings 失败只影响 settings 字段（与原实现一致：settings.success ? data : null）；
    // 但 401/403 要抛出来，让整源按 auth 分类，而不是静默变成「0 篇文章」。
    let settings = null;
    try {
        const body = await ctx.fetchJson(contentUrl(base, 'settings', {}, ctx.env.GHOST_API_KEY), {}, 30000);
        settings = body?.settings && typeof body.settings === 'object' ? body.settings : null;
    } catch (error) {
        if (error?.code === 'auth') throw error;
        ctx.log.warn(`[ghost] settings 获取失败，按 null 处理: ${error.message}`);
    }

    const posts = await browse(ctx, base, 'posts', includeAuthorsTags, (body) => body?.posts, postLimit);
    const pages = await browse(ctx, base, 'pages', includeAuthorsTags, (body) => body?.pages);
    const authorsBody = await ctx.fetchJson(contentUrl(base, 'authors', { include: 'count.posts' }, ctx.env.GHOST_API_KEY), {}, 30000);
    const authors = Array.isArray(authorsBody?.authors) ? authorsBody.authors : [];

    const trimmedPosts = posts.map((p) => trimEntry(p, 'post'));

    // P0 数据安全：ghost 是核心数据。若拉取结果为空（网络/认证失败被静默吞掉），拒绝写入，避免用空数据覆盖线上。
    if (!trimmedPosts.length) {
        throw new Error('Ghost 拉取到 0 篇文章（疑似认证/网络失败），拒绝写入，保留已有数据');
    }

    const tagsBody = await ctx.fetchJson(
        contentUrl(base, 'tags', { order: 'count.posts desc', limit: 'all', include: 'count.posts' }, ctx.env.GHOST_API_KEY),
        {},
        30000
    );
    const tags = Array.isArray(tagsBody?.tags)
        ? tagsBody.tags.map((tag) => ({
              ...pick(tag, [...TAG_FIELDS, 'count']),
              posts: trimmedPosts.filter((p) => p.tags && p.tags.some((t) => t.slug === tag.slug)).map(trimTagPost)
          }))
        : [];

    return {
        outputs: [
            {
                dataset: 'ghost.content',
                data: {
                    settings,
                    posts: trimmedPosts,
                    pages: pages.map((p) => trimEntry(p, 'page')),
                    authors: authors.map((a) => pick(a, AUTHOR_FIELDS)),
                    tags
                },
                complete: true
            }
        ]
    };
}
