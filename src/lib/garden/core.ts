/**
 * 数字花园同步用的纯函数：slug 算法、过滤规则、冲突处理、链接键、标签大小写合并。
 *
 * 这些函数被 `scripts/sync-garden.mjs`、`scripts/check-garden.mjs` 和单测共用，
 * 只放无副作用的计算，不碰文件系统，方便把「同输入同输出」钉死在测试里。
 */
import { createHash } from 'node:crypto';

/* ------------------------------ slug ------------------------------ */

/** Quartz `sluggify`：空白→`-`、`&`→`-and-`、`%`→`-percent`，删掉半角 `?` `#`，其余（含 CJK、大小写、全角符号）原样 */
export function sluggifySegment(segment: string): string {
    return segment
        .replace(/\s/g, '-')
        .replace(/&/g, '-and-')
        .replace(/%/g, '-percent')
        .replace(/\?/g, '')
        .replace(/#/g, '');
}

/**
 * Quartz `slugifyFilePath`：逐段 sluggify 后拼回去。
 * 只去掉最后一个扩展名；`.md` / `.html` 不保留扩展名，`.excalidraw` 这类保留。
 */
export function slugifyFilePath(filePath: string): string {
    const trimmed = filePath.replace(/^\/+|\/+$/g, '');
    const extMatch = trimmed.match(/\.([A-Za-z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const withoutExt = extMatch ? trimmed.slice(0, trimmed.length - extMatch[0].length) : trimmed;
    const slug = withoutExt.split('/').map(sluggifySegment).join('/');
    const normalized = slug.replace(/(^|\/)_index$/, '$1index');
    if (ext === 'md' || ext === 'html' || ext === '') return normalized;
    return `${normalized}.${ext}`;
}

/** 新站的路由 id：Quartz slug 再小写（旧站 Netlify 会把有效 URL 301 成小写） */
export function routeIdOf(relPath: string): string {
    return slugifyFilePath(relPath).toLowerCase();
}

/** 原始大小写版（仅用于生成 legacy alias / 排查） */
export function casedIdOf(relPath: string): string {
    return slugifyFilePath(relPath);
}

/* ------------------------------ 过滤规则 ------------------------------ */

/** 把配置里的 glob 编译成正则；支持 `**`、`*`、`?`，其余字符按字面匹配 */
export function globToRegExp(pattern: string): RegExp {
    let out = '';
    for (let i = 0; i < pattern.length; i += 1) {
        const char = pattern[i];
        if (char === '*') {
            if (pattern[i + 1] === '*') {
                // `**/` 吃掉任意层目录，末尾的 `**` 吃掉剩余路径
                if (pattern[i + 2] === '/') {
                    out += '(?:.*/)?';
                    i += 2;
                } else {
                    out += '.*';
                    i += 1;
                }
            } else {
                out += '[^/]*';
            }
            continue;
        }
        if (char === '?') {
            out += '[^/]';
            continue;
        }
        out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${out}$`, 'i');
}

/** 发布口径：exclude = 默认全收、按黑名单剔除；include = 默认全拦、只收白名单 */
export type GardenPublishMode = 'exclude' | 'include';

export interface GardenFilterRules {
    exclude: readonly string[];
    excludeExtra: readonly string[];
    include: readonly string[];
    /** 缺省时沿用旧规则：include 非空即白名单 */
    publishMode?: GardenPublishMode;
}

const hasGlob = (pattern: string) => /[*?[\]]/.test(pattern);

/**
 * 白名单条目匹配：既接受 glob（`22-Knowledge/**`、`**\/*.md`），
 * 也接受「目录名」写法（`22-Knowledge`、`22-Knowledge/`），后者等价于该目录及其所有子目录，
 * 省得每次都记得补 `/**`。
 */
function matchesIncludeEntry(entry: string, normalized: string): boolean {
    const cleaned = entry
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .replace(/\/+$/, '');
    if (!cleaned) return false;
    if (!hasGlob(cleaned) && !/\.md$/i.test(cleaned)) {
        const lower = normalized.toLowerCase();
        const prefix = cleaned.toLowerCase();
        return lower === prefix || lower.startsWith(`${prefix}/`);
    }
    return globToRegExp(cleaned).test(normalized);
}

export function publishModeOf(rules: GardenFilterRules): GardenPublishMode {
    if (rules.publishMode) return rules.publishMode;
    return rules.include.length > 0 ? 'include' : 'exclude';
}

/**
 * 相对 vault 根判断这个路径要不要收：
 * 1. 任何点开头的目录一律跳过（.obsidian/.trash/.git 等）；
 * 2. 白名单模式先过 include，不在列表里的直接丢；
 * 3. 黑名单最后兜底——白名单模式下 exclude 仍然生效，属于安全底线而不是「反向开关」。
 */
export function shouldPublishPath(relPath: string, rules: GardenFilterRules): boolean {
    const normalized = relPath.replace(/^\.?\//, '');
    if (normalized.split('/').some((part) => part.startsWith('.'))) return false;
    if (publishModeOf(rules) === 'include') {
        // 根目录 index.md 是花园首页的本体（/garden 直接渲染它），不是可选的栏目内容：
        // 白名单里没写也保留，否则站点会因为没有首页而构建失败。
        const isLanding = normalized.toLowerCase() === 'index.md';
        if (!isLanding) {
            if (rules.include.length === 0) return false;
            if (!rules.include.some((entry) => matchesIncludeEntry(entry, normalized))) return false;
        }
    }
    const patterns = [...rules.exclude, ...rules.excludeExtra];
    return !patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

/**
 * 同步前把配置问题一次说清：白名单模式写空列表是最危险的配置——
 * 改错一个字段就会从「全站公开」变成「什么都不发」，所以直接拒绝运行而不是静默降级。
 */
export function gardenConfigProblems(rules: GardenFilterRules): string[] {
    const problems: string[] = [];
    if (rules.publishMode === 'include' && rules.include.length === 0) {
        problems.push('publishMode 为 include 时 include 不能为空，否则没有任何笔记会被发布');
    }
    if (rules.include.some((entry) => !entry.trim())) {
        problems.push('include 里有空条目，删掉或在注释里写说明');
    }
    return problems;
}

/* ------------------------------ 冲突处理 ------------------------------ */

export interface NoteIdentity {
    relPath: string;
    title?: string;
    aliases?: readonly string[];
}

export interface AssignedId {
    relPath: string;
    id: string;
    idCased: string;
    /** 发生冲突时是第几个（从 2 开始），没有冲突为 1 */
    order: number;
}

/**
 * 小写化后的 id 冲突处理：按原始路径排序，先出现者保留 base id，
 * 后面依次得到 `-2`、`-3`。同输入同输出，不依赖文件系统遍历顺序。
 */
export function assignIds(entries: readonly NoteIdentity[]): AssignedId[] {
    const sorted = [...entries].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
    const used = new Map<string, number>();
    return sorted.map((entry) => {
        const idCased = casedIdOf(entry.relPath);
        const base = idCased.toLowerCase();
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        const order = seen + 1;
        return { relPath: entry.relPath, id: order === 1 ? base : `${base}-${order}`, idCased, order };
    });
}

/** 从 id 列表推出所有文件夹路径（保留 id 的小写形式，供文件夹页/左栏树用） */
export function foldersOf(ids: readonly string[]): string[] {
    const folders = new Set<string>();
    for (const id of ids) {
        const parts = id.split('/');
        for (let i = 1; i < parts.length; i += 1) folders.add(parts.slice(0, i).join('/'));
    }
    return [...folders].sort();
}

/* ------------------------------ 标签大小写合并 ------------------------------ */

/**
 * 归一化 frontmatter 里的 tags：Obsidian 允许 `tags: a, b` 这种字符串写法，
 * 也允许 YAML 数组；统一拆成去重后的标签列表。
 */
export function normalizeTags(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value.map((item) => String(item)) : [String(value)];
    const out: string[] = [];
    for (const raw of list) {
        for (const part of raw.split(',')) {
            const tag = part.trim();
            if (tag && !out.includes(tag)) out.push(tag);
        }
    }
    return out;
}

export interface TagCaseGroup {
    key: string;
    display: string;
    count: number;
    variants: string[];
}

/**
 * 标签按小写归并：`Git` / `git` 合成一页，显示名取出现次数最多（并列取字典序靠前）的写法。
 * 返回顺序按 key 排序，保证输出稳定。
 */
export function mergeTagCases(tags: readonly string[]): TagCaseGroup[] {
    const byKey = new Map<string, { display: Map<string, number> }>();
    for (const raw of tags) {
        const tag = raw.trim();
        if (!tag) continue;
        const key = tag.toLowerCase();
        const bucket = byKey.get(key) ?? { display: new Map<string, number>() };
        bucket.display.set(tag, (bucket.display.get(tag) ?? 0) + 1);
        byKey.set(key, bucket);
    }
    return [...byKey.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([key, bucket]) => {
            const variants = [...bucket.display.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
            const count = variants.reduce((sum, [, n]) => sum + n, 0);
            return { key, display: variants[0][0], count, variants: variants.map(([tag]) => tag) };
        });
}

/* ------------------------------ 链接键与链接解析 ------------------------------ */

/** Obsidian 解析链接用的归一化键：NFC、小写、压空白、去 `.md` */
export function normalizeKey(raw: string): string {
    // 先 trim 再去 `.md`：`[[Note.md ]]` 这种带尾空格的写法也要能对上
    return raw
        .normalize('NFC')
        .replace(/\\/g, '/')
        .trim()
        .replace(/\.md$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * 一条笔记在 Obsidian 里可能被别的笔记用来指向它的全部写法（都经 `normalizeKey`）：
 *
 * 1. 完整相对路径 `目录/笔记.md`
 * 2. 去掉扩展名的路径 `目录/笔记`
 * 3. 只有文件名 `笔记`
 * 4. 文件夹笔记的目录路径：`目录/笔记/index.md` → `目录/笔记`
 *
 * 第 4 条是 Quartz 的约定（folder note）：Obsidian 里写 `[[目录/笔记]]`
 * 指向的其实是 `目录/笔记/index.md`，不登记这条键就解析不到。
 */
export function linkKeysOf(relPath: string): string[] {
    const out = new Set<string>();
    const push = (raw: string) => {
        const key = normalizeKey(raw);
        if (key) out.add(key);
    };
    const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    push(normalized);
    const noExt = normalized.replace(/\.md$/i, '');
    push(noExt);
    const segments = noExt.split('/');
    const last = segments[segments.length - 1] ?? noExt;
    // 文件夹笔记的 `index` 不是它的名字：`目录/笔记/index.md` 的文件名键应该是 `笔记`，
    // 否则每篇 folder note 都会抢 `[[index]]` 这个键
    push(last === 'index' && segments.length > 1 ? (segments[segments.length - 2] ?? last) : last);
    // 根笔记 `index.md` 去掉 /index 会得到空串，push 内部会丢弃
    const folderPath = noExt.replace(/\/index$/i, '');
    if (folderPath !== noExt) push(folderPath);
    return [...out];
}

export interface WikiLinkRef {
    /** 括号内原文（可能带 `|别名`、`#标题`、`^块`） */
    raw: string;
    /** 解析目标（不带别名/锚点，可能为空 = 指向本页） */
    target: string;
    /** 是否 `![[...]]` 嵌入 */
    embed: boolean;
}

const WIKI_LINK_RE = /(!?)\[\[([^\]]+)\]\]/g;

/**
 * 去掉 Obsidian 注释块（`%% … %%`）。
 * Waypoint 等插件会把自动生成的目录写在这种注释里，不剥离的话会在正文和摘要里
 * 露出 `%% Begin Waypoint %%` 一路列表。单行注释（`%%备注%%`）同样处理。
 */
export function stripObsidianComments(markdown: string): string {
    return markdown.replace(/^[ \t]*%%[\s\S]*?%%[ \t]*$/gm, '').replace(/%%[\s\S]*?%%/g, '');
}

/** 抽出正文里的 wiki 链接 / 嵌入；不判断能否解析 */
export function extractWikiLinks(markdown: string): WikiLinkRef[] {
    const refs: WikiLinkRef[] = [];
    for (const match of markdown.matchAll(WIKI_LINK_RE)) {
        const raw = match[2];
        const target = raw.split('|')[0].split('#')[0].trim();
        refs.push({ raw, target, embed: match[1] === '!' });
    }
    return refs;
}

/** 是否图片/附件类嵌入（按扩展名） */
export function isAssetTarget(target: string, assetExts: readonly string[]): boolean {
    const lower = target.toLowerCase();
    return assetExts.some((ext) => lower.endsWith(ext));
}

/* ------------------------------ 附件路径 ------------------------------ */

/**
 * 附件镜像路径：**按 Quartz 的 slug 规则改写，并保留原大小写**。
 *
 * 旧站（Quartz）的静态资源同样是 sluggify 过的：正文 `![](Pasted%20image%201.png)`
 * 在页面里是 `99-Rsources/Assets/Pasted-image-1.png`，原样路径反而 404。
 * 大小写则要保留——Netlify 对大小写不敏感、不做 301，旧 URL 里就是 `99-Rsources/Assets`；
 * 统一小写会让旧图片在新站（大小写敏感）上 404。
 */
export function assetMirrorPath(vaultRelPath: string): string {
    return slugifyFilePath(vaultRelPath);
}

/**
 * 附件在站内的 URL：段内按 URL 编码（CJK 等需要），路径本身与镜像一致。
 */
export function assetUrlPath(route: string, mirrorPath: string): string {
    return `${route}/${mirrorPath.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * 标签页 key 集合：层级 tag `a/b/c` 除了自己的页，还产出 `a/b`、`a` 三个页面
 * （旧站 `/tags/privacy`、`/tags/x` 都是 200）。sync 与 check 必须用同一套口径，
 * 否则清单会漏掉父级 tag 页。
 */
export function tagPageKeysOf(keys: readonly string[]): string[] {
    const out = new Set<string>();
    for (const key of keys) {
        const segments = key.split('/').filter(Boolean);
        for (let i = 1; i <= segments.length; i += 1) out.add(segments.slice(0, i).join('/'));
    }
    return [...out].sort();
}

/** 正文里的 wiki 嵌入改写成站内绝对 URL（同样只小写化） */
export function rewriteWikiLinks(markdown: string, resolve: (target: string) => { url: string; label: string } | null): { body: string; unresolved: number } {
    let unresolved = 0;
    const body = markdown.replace(WIKI_LINK_RE, (whole, bang: string, inner: string) => {
        const [targetPart, ...rest] = inner.split('|');
        const target = targetPart.split('#')[0].trim();
        const hit = resolve(target);
        if (!hit) {
            unresolved += 1;
            return whole;
        }
        const label = rest.join('|').trim() || hit.label;
        return bang === '!' ? `![${label}](${hit.url})` : `[${label}](${hit.url})`;
    });
    return { body, unresolved };
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

/**
 * 正文里标准 markdown 图片 `![alt](target)` 的相对路径改写。
 *
 * Obsidian 有两种相对写法（笔记目录相对 `../99-Rsources/…`、vault 根相对 `99-Rsources/…`），
 * 能否解析交给调用方（`resolve` 返回 null = 找不到源文件）。
 * **找不到时不能原样保留**：Astro 会把相对路径当内容资源去 import，构建直接失败；
 * 这里降级成一行说明文字，并计入 missing 供 manifest 记录。
 */
export function rewriteMarkdownImages(
    markdown: string,
    resolve: (target: string) => { url: string; label: string } | null
): { body: string; resolved: number; missing: number } {
    let resolved = 0;
    let missing = 0;
    const body = markdown.replace(MD_IMAGE_RE, (whole, alt: string, target: string, title?: string) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('#')) return whole;
        const hit = resolve(target);
        if (!hit) {
            missing += 1;
            return alt.trim() ? `**[图片缺失：${alt.trim()}]**` : '**[图片缺失]**';
        }
        resolved += 1;
        return `![${alt || hit.label}](${hit.url}${title ?? ''})`;
    });
    return { body, resolved, missing };
}

/* ------------------------------ 杂项 ------------------------------ */

export function sha1(input: string): string {
    return createHash('sha1').update(input).digest('hex');
}

/** 内容摘要：排序后的 `id:hash` 再取 sha1，用于 manifest 与增量构建 cacheKey */
export function contentDigestOf(entries: ReadonlyArray<{ id: string; hash: string }>): string {
    const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return sha1(sorted.map((entry) => `${entry.id}:${entry.hash}`).join('\n'));
}

/** 稳定序列化：键排序 + 2 空格缩进，保证两次同步产物字节一致 */
export function stableJson(value: unknown): string {
    const seen = new WeakSet<object>();
    const sort = (input: unknown): unknown => {
        if (Array.isArray(input)) return input.map(sort);
        if (input && typeof input === 'object') {
            if (seen.has(input as object)) return null;
            seen.add(input as object);
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(input as Record<string, unknown>).sort()) {
                out[key] = sort((input as Record<string, unknown>)[key]);
            }
            return out;
        }
        return input;
    };
    return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/* ------------------------------ 代码区域保护 ------------------------------ */

/**
 * 按「代码 / 非代码」切段调用 `replacer`，第二个参数说明这段是不是代码。
 *
 * 用法上不是「代码区一律不改」，而是让调用方自己决定：围栏代码块（``` / ~~~）与
 * 行内代码里的 `[[x]]` 可能是示例（TOML 的 `[[menu.main]]`、文档里的 `[[note^]]`），
 * 但 Obsidian 的 `image-layout-f` 这类插件的围栏里放的是真图片嵌入，必须照常解析。
 * 所以这里只提供「这段是不是代码」的信息，改不改由 replacer 决定。
 */
export function replaceOutsideCode(markdown: string, replacer: (segment: string, inCode: boolean) => string): string {
    const lines = markdown.split('\n');
    const out: string[] = [];
    let fence: string | null = null;
    for (const line of lines) {
        const fenceMatch = /^[ \t]*(`{3,}|~{3,})/.exec(line);
        if (fence) {
            out.push(replacer(line, true));
            // 闭合围栏：同一种字符且不短于开启串
            if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
            continue;
        }
        if (fenceMatch) {
            fence = fenceMatch[1];
            out.push(replacer(line, true));
            continue;
        }
        // 行内代码：用反引号串长度配对（``…`` 里可以出现单个 `），配对内按代码段处理
        let segment = '';
        let last = 0;
        for (const match of line.matchAll(/(`+)[\s\S]*?\1/g)) {
            segment += replacer(line.slice(last, match.index), false);
            segment += replacer(match[0], true);
            last = match.index + match[0].length;
        }
        out.push(segment + replacer(line.slice(last), false));
    }
    return out.join('\n');
}

/* ------------------------------ 行内 #tag ------------------------------ */

/**
 * 十六进制色值：`#fff` / `#ffffff` / `#1a2b3c` 不是标签。
 * （3/4/6/8 位十六进制，大小写都算）
 */
const HEX_COLOR = /^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** 行首或空白之后的 `#tag`：名字允许中文/字母/数字/`_`/`-`/`/`（层级 tag） */
const INLINE_TAG = /(^|[ \t])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gmu;

/**
 * 行内 `#tag` → 站内标签页链接。
 *
 * 只在「已存在的标签」上转换（`knownTags` 传标签 key 集合，含层级父级），
 * 未知标签原样保留，不制造死链。已处理的几种误伤：
 * - 十六进制色值（`#fff`、`#1a2b3c`）
 * - markdown 标题行（`## 标题`）
 * - 代码区（围栏 / 行内代码，走 `replaceOutsideCode`）
 * - 已经在链接文字里的 `[见 #tag](url)`（再套一层会变成嵌套链接）
 */
export function linkifyInlineTags(markdown: string, knownTags: ReadonlySet<string>): { body: string; linked: number } {
    let linked = 0;
    const body = replaceOutsideCode(markdown, (segment, inCode) => {
        if (inCode) return segment;
        if (/^[ \t]{0,3}#{1,6}[ \t]/.test(segment)) return segment;
        return segment.replace(INLINE_TAG, (whole: string, prefix: string, tag: string, offset: number) => {
            if (HEX_COLOR.test(tag)) return whole;
            const key = tag.toLowerCase();
            if (!knownTags.has(key)) return whole;
            // 链接文字里不再嵌套：`[见 #tag](url)` 的 # 前面方括号没闭合
            const before = segment.slice(0, offset);
            const opens = (before.match(/\[/g) ?? []).length;
            const closes = (before.match(/\]/g) ?? []).length;
            if (opens > closes) return whole;
            linked += 1;
            return `${prefix}[#${tag}](/garden/tags/${key}/)`;
        });
    });
    return { body, linked };
}
