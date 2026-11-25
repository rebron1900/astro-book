/**
 * 划线 tooltip 的 HTML 生成（构建期执行，纯字符串操作，不引任何依赖）。
 *
 * 结构：日期 → 章节 → 引文/批注，每个层级就是一个 section，样式在 timeline.scss 的 .rd-tip-*。
 *
 * 为什么不套 markdown 解析器：划线是电子书里的用户文本，走通用 markdown 会把
 * `[x](javascript:…)`、`<img onerror>` 这类输入带进 HTML 通道，而仓库现有
 * markdown 管线（Sätteri + astro-remote 的 Markup）只对「已渲染好的 HTML」做消毒，
 * 没有对外暴露「任意 md 字符串 → 安全 HTML」的入口。这里改成结构化渲染：
 * 章节 → h3，正文 → blockquote，批注 → em，**先整体转义再无 HTML 透传**，
 * 攻击面为零，也不需要新依赖。需要更强排版时再换管线，组件接口不用动。
 *
 * 颜色不输出色值，改用 CSS 变量类名（见 timeline.scss 的 --rd-hl-accent）。
 */
import { MAX_HIGHLIGHTS, type ReadingHighlight } from './reading';

export function escapeHtml(input: string): string {
    return String(input ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 正文里的换行保留成段落，空行分段。 */
function paragraphs(content: string): string {
    return escapeHtml(content)
        .split(/\n{2,}/)
        .map((para) => para.trim())
        .filter(Boolean)
        .map((para) => `<p>${para.replace(/\n/g, '<br />')}</p>`)
        .join('');
}

interface ChapterGroup {
    chapter: string;
    items: ReadingHighlight[];
}

/** 按章节分组（同一章被别的章隔开也并回同一组），组序按首次出现的顺序。 */
function groupByChapter(highlights: ReadingHighlight[]): ChapterGroup[] {
    const byChapter = new Map<string, ChapterGroup>();
    for (const item of highlights) {
        const chapter = item.chapter || '';
        const group = byChapter.get(chapter);
        if (group) group.items.push(item);
        else byChapter.set(chapter, { chapter, items: [item] });
    }
    return [...byChapter.values()];
}

/**
 * 渲染某天某本书的划线，按「日期 → 章节」两级分组。
 * 卡片本身是一天一张，所以大多数情况只有一组；日期不同说明划线是别的日子留下的
 * （note 的 create_time 与阅读日不一致），此时日期标签才真正起到区分作用。
 * @param highlights 该书全部划线，已按时间升序（未截断）
 */
export function renderHighlights(highlights: ReadingHighlight[]): string {
    if (!highlights || highlights.length === 0) {
        return '<p class="rd-tip-empty">当天没有划线</p>';
    }
    // 取最近 N 条：卡片摘录取的是最新一条，点开能读到同一句，不会出现「引文在面板里找不到」
    const shown = highlights.slice(-MAX_HIGHLIGHTS);

    // 按日期分组，日期新的在前（和卡片「最近的先看」一致），组内仍按时间升序
    const byDate = new Map<string, ReadingHighlight[]>();
    for (const item of shown) {
        const key = item.date || '';
        const list = byDate.get(key) ?? [];
        list.push(item);
        byDate.set(key, list);
    }
    const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    const body = dates
        .map((date) => {
            const heading = date ? `<p class="rd-tip-date"><time datetime="${date}">${formatDayLabel(date)}</time></p>` : '';
            const groups = groupByChapter(byDate.get(date) ?? [])
                .map((group) => {
                    const chapter = group.chapter ? `<h3 class="rd-tip-chapter">${escapeHtml(group.chapter)}</h3>` : '';
                    const quotes = group.items
                        .map((item) => {
                            const note = item.readerNote ? `<p class="rd-tip-note">${escapeHtml(item.readerNote)}</p>` : '';
                            return `<blockquote class="rd-tip-quote">${paragraphs(item.content)}${note}</blockquote>`;
                        })
                        .join('');
                    return `<section class="rd-tip-group">${chapter}${quotes}</section>`;
                })
                .join('');
            return `<section class="rd-tip-day">${heading}${groups}</section>`;
        })
        .join('');

    const rest = highlights.length > MAX_HIGHLIGHTS ? `<p class="rd-tip-rest">还有较早的 ${highlights.length - MAX_HIGHLIGHTS} 条</p>` : '';
    return `${body}${rest}`;
}

/** 「2026-11-20」→「2026 年 11 月 20 日」，构建期纯字符串处理，不受运行环境时区影响。 */
export function formatDayLabel(isoDate: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!m) return isoDate;
    return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
}

/** 卡片上的摘录：取最近一条划线，截 60 字，加中文引号。 */
export function excerptOf(highlights: ReadingHighlight[], limit = 60): string {
    if (!highlights || highlights.length === 0) return '';
    const latest = highlights[highlights.length - 1];
    const text = latest.content.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const clipped = text.length > limit ? `${text.slice(0, limit)}…` : text;
    return `“${clipped}”`;
}

/** 「25 分钟」/「1 小时 20 分钟」——卡片 kicker 与 /reading 页共用（站内文案统一中文）。 */
export function shortDuration(seconds: number): string {
    const raw = Math.max(0, Math.round(seconds / 60));
    // 有阅读但不足一分钟的，按 1 分钟计，避免出现「0 分钟」
    const minutes = raw === 0 && seconds > 0 ? 1 : raw;
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}
