/**
 * 公开性判定：Memos 可见性过滤的唯一一套纯函数。
 *
 * 为什么单独放这里：来源侧（scripts/sync-data.mjs 落地前）与消费者侧
 * （src/api/store.ts 读取时）必须用同一套规则做双保险，否则两处慢慢漂移，
 * 迟早出现「脚本滤了、页面没滤」或反过来。规则本身只有一条：
 * **默认只认明确标记为 PUBLIC 的记录，缺字段一律当非公开**。
 *
 * 设计取舍：默认关闭而不是默认放行。Memos 的 UNLISTED 语义是「不列出，但拿到
 * 链接的人能看」，对公开站点来说仍属于不该自动发布的内容，所以只有显式配置
 * （MEMOS_PUBLISH_VISIBILITIES=public,unlisted）才会放行。
 */

export const MEMO_VISIBILITY_PUBLIC = 'PUBLIC';
/** 默认允许发布的可见性；只在没有显式配置时生效。 */
export const DEFAULT_MEMO_VISIBILITIES = [MEMO_VISIBILITY_PUBLIC];

/** 可见性归一化：去空格、转大写；非字符串一律视为空（= 非公开）。 */
export function normalizeMemoVisibility(value: unknown): string {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/**
 * 解析白名单配置。空值/非法值回落到默认（只 PUBLIC），绝不因为配置写错而放开。
 * 例：'public, unlisted' → ['PUBLIC', 'UNLISTED']
 */
export function parseMemoVisibilities(raw: unknown): string[] {
    if (typeof raw !== 'string' || raw.trim() === '') return [...DEFAULT_MEMO_VISIBILITIES];
    const parsed = raw
        .split(',')
        .map((item) => normalizeMemoVisibility(item))
        .filter(Boolean);
    const unique = [...new Set(parsed)];
    return unique.length ? unique : [...DEFAULT_MEMO_VISIBILITIES];
}

/** 单条记录是否可发布；visibility 缺失、大小写不符、非字符串都不放行。 */
export function isPublishableMemo(memo: { visibility?: unknown } | null | undefined, allowed: readonly string[] = DEFAULT_MEMO_VISIBILITIES): boolean {
    if (!memo || !Array.isArray(allowed) || allowed.length === 0) return false;
    return allowed.includes(normalizeMemoVisibility(memo.visibility));
}

/** 过滤一批记录；输入不是数组时返回空数组（不抛错，避免下游整页崩掉）。 */
export function filterPublishableMemos<T extends { visibility?: unknown }>(memos: readonly T[] | null | undefined, allowed: readonly string[] = DEFAULT_MEMO_VISIBILITIES): T[] {
    if (!Array.isArray(memos)) return [];
    return memos.filter((memo) => isPublishableMemo(memo, allowed));
}

/**
 * 把 HTML 片段压成纯文本特征：去标签、去脚本/样式块、合并空白。
 * 只用于「是否泄露」的检测，不用于展示。
 */
export function memoPlainText(content: unknown): string {
    if (typeof content !== 'string' || content === '') return '';
    return content
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 生成一条非公开记录的可搜索特征（默认取前 40 字）。
 * 太短的（< 12 字）不生成特征：到处都能撞见，反而产生假警报。
 */
export function memoTextFeature(content: unknown, length = 40): string {
    const text = memoPlainText(content);
    if (text.length < 12) return '';
    return text.slice(0, Math.max(12, length));
}

/** 一条记录在发布侧的全部特征（正文 + 资源文件名），去重后返回。 */
export function memoLeakFeatures(memo: { content?: unknown }, length = 40): string[] {
    const feature = memoTextFeature(memo?.content, length);
    return feature ? [feature] : [];
}
