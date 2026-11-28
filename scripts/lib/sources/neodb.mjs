/**
 * NeoDB 标记 → src/data/neodb.json（douban 页）。
 *
 * 迁移自 scripts/sync-data.mjs 的 syncNeodb / trimNeodb / pickChineseTitle / neodbKey，行为逐行保留：
 * 按 shelf 翻页、3 次重试 + 150ms 页间隔、增量（本页全是已知即停）、SYNC_FULL 全量、
 * 中文译名沿用上一版、空结果拒写、按 created_time 降序、字段白名单裁剪。
 *
 * 上一版数据从 ctx.previous('neodb.marks') 取（执行器读 src/data/neodb.json），模块不碰文件系统。
 * Authorization 走 Base64 Basic 之外的 Bearer；跨源跳转时由执行器按 meta.sensitiveHeaders 剥掉。
 */
export const meta = {
    id: 'neodb',
    optional: false,
    credentials: ['NEODB_TOKEN'],
    // SYNC_FULL 不是密钥，但只有声明过执行器才会注入；--full / SYNC_FULL=1 时它决定全量还是增量
    optionalCredentials: ['NEODB_API_URL', 'NEODB_SHELVES', 'SYNC_FULL'],
    sensitiveHeaders: ['authorization'],
    datasets: ['neodb.marks'],
    datasetVersions: { 'neodb.marks': 1 },
    description: 'NeoDB 书影音标记（增量合并后的全集，按 created_time 降序）'
};

// NeoDB 条目消费字段（douban 页）
// brief：没有短评的标记用它当卡片的回退文案（作品简介），同步时按需从条目接口补齐
const NEODB_ITEM_FIELDS = ['id', 'title', 'category', 'cover_image_url', 'url', 'uuid', 'localized_title', 'type', 'brief'];
const NEODB_MARK_FIELDS = ['post_id', 'shelf', 'type', 'title', 'comment_text', 'rating_grade', 'item', 'created_time', 'visibility'];

function pick(obj, fields) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const f of fields) {
        if (f in obj) out[f] = obj[f];
    }
    return out;
}

// 提取中文标题：优先简体中文 localized_title，找不到时回退到其他中文标题和 title。
// TVSeason 常把“第 1 季”放在 zh-cn 中，不能把它当作品名；应继续找其他中文译名。
const CHINESE_TITLE_LANGS = ['zh-cn', 'zh-hans', 'zh', 'zh-sg', 'zh-hk', 'zh-tw', 'zh-hant'];
const SEASON_ONLY_TITLE = /^第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*季$/;

export function pickChineseTitle(item, previousTitle) {
    if (!item) return undefined;

    const localized = Array.isArray(item.localized_title) ? item.localized_title : [];
    const chineseTitles = CHINESE_TITLE_LANGS.flatMap((lang) =>
        localized
            .filter((title) => title?.lang === lang && typeof title.text === 'string' && /[\u4e00-\u9fff]/.test(title.text))
            .map((title) => title.text.trim())
            .filter(Boolean)
    );

    // 先排除 TVSeason 常见的纯季名；若上游没有完整中文译名，保留上一次同步的中文名，避免数据回退。
    return (
        chineseTitles.find((title) => !SEASON_ONLY_TITLE.test(title)) ||
        ([item.title, previousTitle].find(
            (title) => typeof title === 'string' && /[\u4e00-\u9fff]/.test(title) && !SEASON_ONLY_TITLE.test(title.trim())
        ) ?? item.title)
    );
}

/** 字段裁剪 + 中文名补齐（previousItems：上一版 item，供 title_cn 沿用）。 */
export function trimNeodb(data, previousItems = new Map()) {
    if (!Array.isArray(data)) return data;
    return data.map((m) => {
        const out = pick(m, NEODB_MARK_FIELDS);
        if (out.item) {
            out.item = pick(out.item, NEODB_ITEM_FIELDS);
            const previousItem = previousItems.get(out.item.uuid);
            // 生成中文标题字段（douban 页展示用）
            out.item.title_cn = pickChineseTitle(out.item, previousItem?.title_cn || previousItem?.title);
        }
        return out;
    });
}

function neodbKey(mark) {
    return String(mark?.post_id ?? `${mark?.item?.uuid || ''}|${mark?.created_time || ''}`);
}

/** 简介最多存这么多字：卡片只露两行，多存的只给悬停提示用 */
const BRIEF_MAX = 240;

/** 把简介压成一行、截到上限；空白返回 undefined */
export function normalizeBrief(text) {
    if (typeof text !== 'string') return undefined;
    const flat = text.replace(/\s+/g, ' ').trim();
    if (!flat) return undefined;
    return flat.length > BRIEF_MAX ? `${flat.slice(0, BRIEF_MAX).trimEnd()}…` : flat;
}

/**
 * NeoDB 给部分条目只填了一句「film directed by X」这种占位简介：
 * 篇幅很短、句式就是「谁拍的/谁写的」，当卡片文案没信息量，不如不显示。
 */
const STUB_BRIEF = /^(?:a\s+)?(?:film|movie|tv\s*(?:series|show)|book|novel|album|podcast|game)\b[^。.!?]{0,40}?\b(?:directed|written|created|produced|by)\b/i;

/** 从 brief / description 里挑一段能用的简介；都是占位台词就返回 undefined */
export function pickBriefText(brief, description) {
    const candidates = [normalizeBrief(brief), normalizeBrief(description)];
    const usable = (text) => Boolean(text) && !(text.length < 90 && STUB_BRIEF.test(text));
    const [shortBrief, desc] = candidates;
    const briefOk = usable(shortBrief);
    const descOk = usable(desc);
    // brief 只是一句话、description 更长时用 description
    if (briefOk && !(descOk && shortBrief.length < 80 && desc.length > shortBrief.length + 40)) return shortBrief;
    if (descOk) return desc;
    return undefined;
}

/** 判断一个已存的简介是不是占位台词（回填脚本用它清理旧数据） */
export function isStubBrief(text) {
    const flat = normalizeBrief(text);
    return Boolean(flat) && flat.length < 90 && STUB_BRIEF.test(flat);
}

/**
 * 没有短评的标记，补一段作品简介当卡片回退文案。
 *
 * 走 NeoDB 公开的条目接口（不需要 token），已经有 brief 的不再请求——
 * 增量同步时只有新标记会发请求。失败只记数不抛出：简介是锦上添花，
 * 不该让整个书影音同步因此失败。
 */
export async function enrichBriefs(marks, { apiBase, fetchJson, log }, { gapMs = 120, attempts = 2 } = {}) {
    const targets = marks.filter((mark) => !String(mark?.comment_text ?? '').trim() && mark?.item?.uuid && !mark.item.brief);
    if (targets.length === 0) return 0;

    const fetchDetail = async (category, uuid) =>
        fetchJson(`${apiBase}/${encodeURIComponent(category)}/${encodeURIComponent(uuid)}`, { headers: { Accept: 'application/json', 'User-Agent': 'astro-book-sync' } }, 20000);

    let filled = 0;
    let failed = 0;
    for (const mark of targets) {
        const { category, uuid } = mark.item;
        let brief;
        let parentUuid;
        for (let attempt = 1; attempt <= attempts && !brief; attempt += 1) {
            try {
                const detail = await fetchDetail(category, uuid);
                brief = pickBriefText(detail?.brief, detail?.description);
                parentUuid = typeof detail?.parent_uuid === 'string' ? detail.parent_uuid : undefined;
            } catch {
                // 都重试一次：上游偶发超时/限流，单条失败不影响整体
                if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
        // 季（TVSeason）本身没有简介，作品简介写在父级剧集上
        if (!brief && parentUuid) {
            try {
                const parent = await fetchDetail(category, parentUuid);
                brief = pickBriefText(parent?.brief, parent?.description);
            } catch {
                // 父级取不到就当没有简介
            }
        }
        if (brief) {
            mark.item.brief = brief;
            filled += 1;
        } else {
            failed += 1;
        }
        if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
    log?.(`[neodb] 简介补齐：需要 ${targets.length} 条，补上 ${filled} 条${failed ? `，失败 ${failed} 条` : ''}`);
    return filled;
}

export async function collect(ctx) {
    const token = ctx.env.NEODB_TOKEN;
    const apiBase = (ctx.env.NEODB_API_URL || 'https://neodb.social/api').replace(/\/$/, '');
    const shelves = (ctx.env.NEODB_SHELVES || 'complete')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const fullSync = ctx.env.SYNC_FULL === '1';
    const previousData = ctx.previous('neodb.marks');
    const previousMarks = Array.isArray(previousData?.data) ? previousData.data : [];
    const previousItems = new Map(previousMarks.filter((m) => m.item?.uuid).map((m) => [m.item.uuid, m.item]));
    const known = new Set(previousMarks.map(neodbKey));
    const fetched = [];

    for (const shelf of shelves) {
        let page = 1;
        let pages = 1;
        do {
            let data;
            let lastError;
            for (let attempt = 1; attempt <= 3; attempt += 1) {
                try {
                    data = await ctx.fetchJson(
                        `${apiBase}/me/shelf/${encodeURIComponent(shelf)}?page=${page}`,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                Accept: 'application/json',
                                'User-Agent': 'astro-book-sync'
                            }
                        },
                        30000
                    );
                    break;
                } catch (error) {
                    // 401/403 重试没有意义，直接按 auth 抛出去（也避免为了分类白等 3 秒）
                    if (error?.code === 'auth') throw error;
                    lastError = error;
                    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
                }
            }
            // 保留执行器给出的分类（401/403 → auth，429/5xx → upstream），别把分类信息吞成 upstream
            if (!data) {
                if (lastError?.code) throw lastError;
                throw new Error(`[neodb] ${shelf} 第 ${page} 页获取失败: ${lastError?.message || '未知错误'}`);
            }
            if (!Array.isArray(data.data)) throw new Error(`[neodb] ${shelf} 第 ${page} 页响应缺少 data 数组`);

            const pageMarks = data.data.map((mark) => ({ ...mark, shelf: mark.shelf ?? mark.shelf_type }));
            const pageNew = pageMarks.filter((mark) => !known.has(neodbKey(mark)));
            if (!fullSync && previousMarks.length > 0 && pageNew.length === 0) {
                break;
            }
            fetched.push(...(fullSync ? pageMarks : pageNew));
            pageNew.forEach((mark) => known.add(neodbKey(mark)));
            pages = Math.max(1, Number(data.pages) || 1);
            page += 1;
            if (page <= pages) await new Promise((resolve) => setTimeout(resolve, 150));
        } while (page <= pages);
    }

    const merged = fullSync ? fetched : [...previousMarks, ...fetched];
    if (merged.length === 0) throw new Error('[neodb] API 返回 0 条记录，拒绝覆盖已有数据');
    const deduped = [...new Map(merged.map((mark) => [neodbKey(mark), mark])).values()];
    deduped.sort((a, b) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime());
    ctx.log(`[neodb] ${fullSync ? '全量' : '增量'}同步：拉取 ${fetched.length} 条，合并后 ${deduped.length} 条`);

    // 没有短评的条目补一段简介当卡片回退（已有 brief / 上一版已补过的不会重复请求）
    await enrichBriefs(deduped, { apiBase, fetchJson: ctx.fetchJson, log: ctx.log });

    return { outputs: [{ dataset: 'neodb.marks', data: { data: trimNeodb(deduped, previousItems) }, complete: true }] };
}
