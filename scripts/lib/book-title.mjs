/**
 * 书名 / 作者清洗规则（纯函数，带单测）。
 *
 * 真实数据里的脏样本（modureader 从电子书文件名推出来的标题）：
 *   `于谦动物园 (于谦) (z-library.sk, 1lib.sk, z-lib.sk)`
 *   `三十岁的成人礼_搭车去柏林_刘畅著,_刘畅,_author,_Liu_C_z_library_sk,_1lib_sk,`
 *   `怀孕呵护指南【豆瓣评分9.3！超人气女性健康科普达人六层楼先生…】`
 *   `挽救计划(《火星救援》作者安迪·威尔全新力作,出版后连续16周…）`
 * 作者：`Unknown`、`【美】史蒂文·普莱斯菲尔德`、`[德]埃克哈特·托利`、`(日)东野圭吾`、`[日] 石田裕辅`
 *
 * 规则放在这里而不是组件里，改规则有测试兜住；展示名最终以
 * `src/data/book-title-overrides.json` 为准，清洗改版不影响历史卡片。
 */

/** 盗版库/站点尾巴，锚定在字符串末尾（真实数据里这类后缀总是在尾部）。 */
const SITE_TAIL =
    /[\s_]*[(\[【（][^)\]}）】\n]*(?:z[\s_-]?library|1lib|z[\s_-]?lib|libgen|annas?[\s_-]?archive)[^)\]}）】\n]*[)\]}）】]?[\s,_-]*$|_?[A-Za-z0-9_]*?(?:z[\s_-]?library|1lib)[\s\w,._-]*$/i;

/** 文件名残留的作者/版本片段：`_刘畅著,_刘畅,_author,_Liu`。 */
const AUTHOR_TAIL = /(?:[_＿][^_＿\n]{0,30}(?:著|编著|译|主编|author))[^\n]*$/i;

/**
 * 括号内是营销语（豆瓣评分/推荐语/出版宣传…）时整段砍掉。
 * 「全集 / 套装 / 年度版 / 榜」是版本标记或合法书名成分，不算营销词。
 */
const MARKETING_PAREN = /[（(【\[]([^）)】\]]*(?:豆瓣|评分|推荐|力作|畅销|出版后|超人气|epub|mobi|pdf|azw3)[^）)】\]]*)[）)】\]]/gi;

/** `【…】` 装饰块整体砍掉。 */
const FULLWIDTH_BRACKET = /【[^】]*】/g;

/** 结尾的分隔符与标点。 */
const TRAILING_JUNK = /[\s_\-—–,，、:：;；|/\\]+$/;

function squeeze(text) {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * 括号没闭合（书名被截断，如 `【豆瓣评分9.3！…`）时，从最后一个未闭合的左括号处截断。
 * 只处理出现在标题后半段的情况，避免砍掉正常开头。
 */
function cutUnclosedBracket(text) {
    const pairs = [
        ['【', '】'],
        ['（', '）'],
        ['(', ')'],
        ['[', ']']
    ];
    let cutAt = -1;
    for (const [open, close] of pairs) {
        const lastOpen = text.lastIndexOf(open);
        if (lastOpen <= 0) continue;
        if (!text.slice(lastOpen + 1).includes(close)) {
            cutAt = cutAt === -1 ? lastOpen : Math.min(cutAt, lastOpen);
        }
    }
    return cutAt === -1 ? text : text.slice(0, cutAt);
}

/**
 * 清洗书名。只做「去噪」，不做缩写——缩写属于人工判断，进 overrides。
 * @param {string} raw
 * @returns {string}
 */
export function cleanBookTitle(raw) {
    if (!raw) return '';
    let title = String(raw).normalize('NFC');
    title = title.replace(SITE_TAIL, ' ');
    title = title.replace(MARKETING_PAREN, ' ');
    title = title.replace(FULLWIDTH_BRACKET, ' ');
    title = title.replace(AUTHOR_TAIL, ' ');
    title = cutUnclosedBracket(title);
    // 砍完只剩空括号的，一并去掉
    title = title.replace(/[（(【\[]\s*[）)】\]]/g, ' ');
    title = squeeze(title);
    title = title.replace(TRAILING_JUNK, '');
    return squeeze(title);
}

/**
 * 清洗作者。`Unknown`/空 → ''（调用方据此整行不渲染）。
 * 国别前缀原样保留：`【美】xxx`、`[德] xxx`、`(日)xxx`。
 * @param {string} raw
 * @returns {string}
 */
export function cleanBookAuthor(raw) {
    if (!raw) return '';
    let author = squeeze(String(raw).normalize('NFC'));
    if (!author) return '';
    if (/^(unknown|未知|佚名|n\/?a|null|none|-+)$/i.test(author)) return '';
    author = author.replace(/_+/g, ' ');
    author = squeeze(author.replace(/\s*[,，]\s*$/, ''));
    if (/^(unknown|未知|佚名|n\/?a|null|none)$/i.test(author)) return '';
    return author;
}

/**
 * 应用人工映射表：键可以是 sync_id（`md5:…`）或清洗后的书名。
 * @param {{ title: string, author: string }} meta
 * @param {string} syncId
 * @param {Record<string, { title?: string, author?: string, hide?: boolean }>} overrides
 */
export function applyOverride(meta, syncId, overrides = {}) {
    const hit = overrides[syncId] ?? overrides[meta.title] ?? null;
    if (!hit) return { ...meta, hide: false };
    return {
        title: hit.title || meta.title,
        author: hit.author !== undefined ? hit.author : meta.author,
        hide: Boolean(hit.hide)
    };
}
