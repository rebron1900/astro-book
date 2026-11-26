/**
 * 动态来源（Memos / GoToSocial）→ src/data/memos.json（now 页）。
 *
 * 迁移自 scripts/sync-data.mjs 的 syncMemos / syncGtsMemos / trimMemos / gtsStatusToMemo，
 * 行为逐行保留（含增量停止条件、去重顺序、隐私过滤与「空结果拒绝覆盖」）。
 *
 * 隐私是硬边界：非公开动态绝不允许落地。规则来自 src/lib/privacy.ts（store 侧复用同一套），
 * 这里的 trimMemos 只是把白名单字段裁出来，不做任何「缺失就兜底成公开」的推断。
 *
 * 两个上游：
 *  - GoToSocial（首选）：GOTOSOCIAL_URL + GOTOSOCIAL_TOKEN，GOTOSOCIAL_ACCOUNT_ID 可选（缺则 verify_credentials）。
 *  - 旧 Memos API（兜底）：不读 env，地址取 src/config/site.ts 的 memos.url；这一路本来就不需要密钥，
 *    所以两者都放进 optionalCredentials，避免「只有旧 Memos 可用」的环境被当成缺凭据硬失败。
 */
import { DEFAULT_MEMO_VISIBILITIES, filterPublishableMemos, normalizeMemoVisibility, parseMemoVisibilities } from '../../../src/lib/privacy.ts';
import { siteConfig } from '../../../src/config/site.ts';

export const meta = {
    id: 'memos',
    optional: false,
    // GTS 与旧 Memos 是二选一：都缺时走无密钥的旧 API，因此这里没有必需凭据
    credentials: [],
    optionalCredentials: ['GOTOSOCIAL_URL', 'GOTOSOCIAL_TOKEN', 'GOTOSOCIAL_ACCOUNT_ID', 'MEMOS_PUBLISH_VISIBILITIES'],
    // GTS 用 Authorization: Bearer；跨源跳转必须剥掉
    sensitiveHeaders: ['authorization'],
    datasets: ['memos.list'],
    datasetVersions: { 'memos.list': 1 },
    description: '动态（GoToSocial 优先 / 旧 Memos API 兜底），落地前按 src/lib/privacy.ts 过滤非公开'
};

// Memo 消费字段（now 页）
const MEMO_FIELDS = ['id', 'content', 'createdTs', 'updatedTs', 'creatorName', 'resourceList', 'visibility', 'pinned'];
const RESOURCE_FIELDS = ['type', 'filename', 'link', 'externalLink'];

function pick(obj, fields) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const f of fields) {
        if (f in obj) out[f] = obj[f];
    }
    return out;
}

/**
 * 隐私边界 + 字段裁剪：非公开动态在这里被丢掉，绝不会进入返回值。
 * 整批都不可发布时抛错（不拿空数组覆盖已有文件）。
 * @param {object[]} memos
 * @param {string[]|undefined} allowedVisibilities 显式放开的可见性（默认只 PUBLIC）
 * @param {Function} log 默认 console.log，便于测试与执行器接管
 */
export function trimMemos(memos, allowedVisibilities, log = console.log) {
    const allowed = Array.isArray(allowedVisibilities) && allowedVisibilities.length ? allowedVisibilities : undefined;
    const publishable = filterPublishableMemos(memos, allowed ?? DEFAULT_MEMO_VISIBILITIES);
    const dropped = memos.length - publishable.length;
    log(`[memos] 可见性过滤：保留 ${publishable.length} 条（允许 ${(allowed ?? DEFAULT_MEMO_VISIBILITIES).join('/')}），丢弃 ${dropped} 条非公开`);
    if (publishable.length === 0 && memos.length > 0) {
        throw new Error(`[memos] ${memos.length} 条记录全部不在发布白名单内（${(allowed ?? DEFAULT_MEMO_VISIBILITIES).join('/')}），拒绝用空数据覆盖已有文件`);
    }
    return publishable.map((m) => {
        const out = pick(m, MEMO_FIELDS);
        if (Array.isArray(out.resourceList)) out.resourceList = out.resourceList.map((r) => pick(r, RESOURCE_FIELDS));
        return { ...out, type: 'memo' };
    });
}

function gtsTimestamp(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? Math.floor(time / 1000) : 0;
}

function gtsResourceList(status) {
    const attachments = Array.isArray(status.media_attachments) ? status.media_attachments : [];
    return attachments
        .filter((attachment) => attachment && (attachment.type === 'image' || attachment.type === 'video' || attachment.type === 'gifv' || attachment.type === 'audio'))
        .map((attachment) => ({
            type: attachment.type === 'gifv' ? 'video' : attachment.type,
            filename: attachment.url || attachment.remote_url || '',
            externalLink: attachment.remote_url || attachment.url || '',
            link: attachment.text_url || attachment.url || ''
        }));
}

/** GoToSocial status → 落地 memo（含转嘟拼装与 visibility 归一）。 */
export function gtsStatusToMemo(status, owner) {
    const source = status.reblog || status;
    const author = status.account || owner || {};
    const sourceAuthor = source.account || author;
    const boostContent = status.reblog
        ? `${author.display_name || author.username || '我'} 转嘟 <a href="${sourceAuthor.url || '#'}" target="_blank" rel="noopener noreferrer">@${sourceAuthor.acct || sourceAuthor.username || '未知'}</a>:\n${source.content || ''}`
        : status.content || '';

    return {
        id: status.id,
        content: boostContent,
        createdTs: gtsTimestamp(status.created_at),
        updatedTs: gtsTimestamp(status.edited_at || status.created_at),
        creatorName: author.display_name || author.username || '1900',
        resourceList: gtsResourceList(source),
        // 归一化复用 src/lib/privacy.ts 的同一套规则：缺字段、非字符串、空串一律落成 ''（= 非公开），
        // 绝不把上游缺失兜底成 public —— 兜底公开等于默认泄露，与规范相反。
        visibility: normalizeMemoVisibility(status.visibility),
        pinned: Boolean(status.pinned),
        type: 'memo'
    };
}

/** GoToSocial：按 max_id 翻页，命中「本页全是已知」即停（增量），--full 时全量重拉。 */
async function collectGts(ctx) {
    const base = String(ctx.env.GOTOSOCIAL_URL).replace(/\/$/, '');
    const headers = {
        Authorization: `Bearer ${ctx.env.GOTOSOCIAL_TOKEN}`,
        Accept: 'application/json',
        'User-Agent': 'astro-book-sync'
    };
    let accountId = ctx.env.GOTOSOCIAL_ACCOUNT_ID;
    let owner = null;
    if (!accountId) {
        owner = await ctx.fetchJson(`${base}/api/v1/accounts/verify_credentials`, { headers }, 20000);
        accountId = owner?.id;
        if (!accountId) throw new Error('[memos] GoToSocial 未能返回当前账号 ID');
    }

    const fullSync = ctx.env.SYNC_FULL === '1';
    const previousData = ctx.previous('memos.list');
    const previous = Array.isArray(previousData) ? previousData : [];
    const known = new Set(previous.map((memo) => String(memo.id)));
    const fetched = [];
    let maxId = '';
    let stoppedEarly = false;

    for (let page = 0; page < 200; page += 1) {
        const url = `${base}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?limit=40${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`;
        const statuses = await ctx.fetchJson(url, { headers }, 30000);
        if (!Array.isArray(statuses) || statuses.length === 0) break;

        const newStatuses = statuses.filter((status) => status.id && !known.has(String(status.id)));
        if (!fullSync && previous.length > 0 && newStatuses.length === 0) {
            stoppedEarly = true;
            break;
        }
        fetched.push(...(fullSync ? statuses : newStatuses).map((status) => gtsStatusToMemo(status, owner)));
        statuses.forEach((status) => status.id && known.add(String(status.id)));
        const lastId = statuses[statuses.length - 1]?.id;
        if (!lastId || lastId === maxId) break;
        maxId = lastId;
        if (statuses.length < 40) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const merged = fullSync ? fetched : [...previous, ...fetched];
    if (merged.length === 0) throw new Error('[memos] GoToSocial 返回 0 条动态，拒绝覆盖已有数据');
    // 同一 id 后出现的（本次拉到的）胜出
    const deduped = [...new Map(merged.map((memo) => [String(memo.id), memo])).values()];
    deduped.sort((a, b) => Number(b.createdTs) - Number(a.createdTs));
    ctx.log(`[memos] ${fullSync ? '全量' : '增量'}同步：拉取 ${fetched.length} 条，合并后 ${deduped.length} 条${stoppedEarly ? '（增量提前停止）' : ''}`);
    return trimMemos(deduped, parseMemoVisibilities(ctx.env.MEMOS_PUBLISH_VISIBILITIES), ctx.log.log);
}

/**
 * 旧 Memos API 兜底：地址来自 site.ts，不读 env。
 * 这里刻意保留原来的「非 2xx 只 warn 并停止翻页」语义（旧实现如此，不改成硬失败）；
 * X-Total-Count 只用来提前结束翻页，缺失时靠「本页不足一页」判断。
 * 不经过 ctx.fetchJson：它需要读响应头，且旧行为是「失败保留已取到的部分」。
 */
async function collectLegacy(ctx) {
    const all = [];
    let offset = 0;
    const PAGE = 50;
    for (;;) {
        const url = `${siteConfig.memos.url}?limit=${PAGE}&offset=${offset}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) {
            ctx.log.warn(`[memos] HTTP ${res.status}，停止拉取`);
            break;
        }
        const total = parseInt(res.headers.get('X-Total-Count') || '0', 10);
        const page = await res.json();
        all.push(...(Array.isArray(page) ? page : []));
        offset += PAGE;
        if (!total || offset >= total) break;
        if (page.length < PAGE) break;
    }
    if (all.length === 0) throw new Error('[memos] 旧 Memos API 返回 0 条动态，拒绝覆盖已有数据');
    return trimMemos(
        all.map((m) => ({ ...m, type: 'memo' })),
        parseMemoVisibilities(ctx.env.MEMOS_PUBLISH_VISIBILITIES),
        ctx.log.log
    );
}

export async function collect(ctx) {
    const useGts = Boolean(ctx.env.GOTOSOCIAL_URL && ctx.env.GOTOSOCIAL_TOKEN);
    const data = useGts ? await collectGts(ctx) : await collectLegacy(ctx);
    return { outputs: [{ dataset: 'memos.list', data, complete: true }] };
}
