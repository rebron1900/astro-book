/**
 * 敏感认证头：通用声明 + 判定 + 剥离。
 *
 * 为什么单独一层：执行器原来硬编码一张 `AUTH_HEADERS` 列表，只认识 Emby 的
 * `X-Emby-Token`。接第三个来源时，只要它用一个新的自定义认证头（比如
 * `X-Foo-Token`、`x-session-id`、`X-Api-Key`），跨源跳转时就会原样带过去 ——
 * 这是「接第三源前」就存在的已知泄密缺口，不该靠「记得往列表里加一行」来兜。
 *
 * 规则（两层，取并集）：
 *  1. 通用模式：头名里出现 auth / cookie / token / secret / session / api-key /
 *     credential / signature / password 之一，一律视为敏感。新来源无需登记即受保护。
 *  2. 显式声明：来源在 `meta.sensitiveHeaders` 里列出的名字（哪怕不含上面任何词，
 *     比如 `x-acme`），也一律视为敏感。用于兜住命名不规整的私有头。
 *
 * 只做「跨源时剥离」这一件事；同源跳转一律保留（取图、分页都要用）。
 */

/** 内置基线：任何情况下都算敏感。保留导出名 AUTH_HEADERS 的语义兼容。 */
export const BASE_SENSITIVE_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'cookie2', 'set-cookie'];

/** 通用模式：命中即敏感。刻意不收窄到 `^x-`，第 N 方来源的头名不可预知。 */
const SENSITIVE_PATTERN = /(?:^|[-_])(auth|authorization|cookie|token|secret|session|api[-_]?key|apikey|password|passwd|credential|signature)/i;

/** 头名归一：去空格、转小写。 */
export function normalizeHeaderName(name) {
    return String(name ?? '').trim().toLowerCase();
}

/** 把一个来源 meta 里声明的敏感头归一成数组（容错：非数组、含空值都不报错）。 */
export function declaredSensitiveHeaders(meta) {
    const raw = meta?.sensitiveHeaders;
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeHeaderName).filter(Boolean);
}

/**
 * 单个头名是否敏感。
 * @param {string} name 头名
 * @param {string[]} declared 来源显式声明的敏感头（已归一或未归一都可）
 */
export function isSensitiveHeader(name, declared = []) {
    const normalized = normalizeHeaderName(name);
    if (!normalized) return false;
    if (BASE_SENSITIVE_HEADERS.includes(normalized)) return true;
    if (declared.some((item) => normalizeHeaderName(item) === normalized)) return true;
    return SENSITIVE_PATTERN.test(normalized);
}

/**
 * 从 `[name, value]` 头对里剥掉敏感头，返回新数组（不改原数组）。
 * @param {Array<[string, string]>} pairs
 * @param {string[]} declared
 */
export function stripSensitiveHeaders(pairs, declared = []) {
    return (Array.isArray(pairs) ? pairs : []).filter(([name]) => !isSensitiveHeader(name, declared));
}
