/**
 * 划线 tooltip 的 HTML 生成（构建期执行，纯字符串操作，不引任何依赖）。
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
 * 渲染某天某本书的划线。
 * @param highlights 当天该书全部划线，已按时间升序（未截断）
 */
export function renderHighlights(highlights: ReadingHighlight[]): string {
    if (!highlights || highlights.length === 0) {
        return '<p class="rd-tip-empty">当天没有划线</p>';
    }
    // 取最近 N 条：卡片摘录取的是最新一条，点开能读到同一句，不会出现「引文在面板里找不到」
    const shown = highlights.slice(-MAX_HIGHLIGHTS);

    const body = groupByChapter(shown)
        .map((group) => {
            const heading = group.chapter ? `<h3 class="rd-tip-chapter">${escapeHtml(group.chapter)}</h3>` : '';
            const quotes = group.items
                .map((item) => {
                    const note = item.readerNote ? `<p class="rd-tip-note">${escapeHtml(item.readerNote)}</p>` : '';
                    return `<blockquote class="rd-tip-quote">${paragraphs(item.content)}${note}</blockquote>`;
                })
                .join('');
            return `<section class="rd-tip-group">${heading}${quotes}</section>`;
        })
        .join('');

    const rest = highlights.length > MAX_HIGHLIGHTS ? `<p class="rd-tip-rest">还有较早的 ${highlights.length - MAX_HIGHLIGHTS} 条</p>` : '';
    return `${body}${rest}`;
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

/** 「25 min」/「1h 20m」——卡片 kicker 与 /reading 页共用。 */
export function shortDuration(seconds: number): string {
    const minutes = Math.max(0, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
