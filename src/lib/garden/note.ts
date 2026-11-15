/**
 * 花园笔记的小工具：标题取值与祖先链。
 *
 * 放在独立模块里而不是页面 frontmatter 中——`getStaticPaths` 会被 Astro 抽到单独的
 * prerender 模块，页面里定义的 const 函数在打包后可能被 tree-shake 掉（实测报
 * `ancestorsOf is not defined`），从模块 import 才稳。
 */

export interface GardenCrumb {
    label: string;
    path: string;
}

export interface NoteLike {
    id: string;
    data: { title?: unknown };
    body?: string | null;
}

/** 标题优先 frontmatter，其次正文首个 H1（大量笔记没有 frontmatter），最后用 id 末段 */
export function noteTitleOf(entry: NoteLike): string {
    const fallback = entry.id.split('/').pop() ?? entry.id;
    // 先去掉围栏代码块：里面 `# /etc/nginx/...` 这种注释会被误当成 H1
    const withoutCode = (entry.body ?? '').replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~$/gm, '');
    const firstH1 = /^[ \t]*#[ \t]+(\S.+?)[ \t]*$/m.exec(withoutCode)?.[1];
    return String(entry.data?.title ?? firstH1 ?? fallback).trim() || fallback;
}

/** `/a/b/c` → `[{label:'a',path:'a'},{label:'b',path:'a/b'}]`（不含自身） */
export function ancestorsOf(id: string): GardenCrumb[] {
    const segments = id.split('/');
    return segments.slice(0, -1).map((_, index) => ({
        label: segments[index] ?? '',
        path: segments.slice(0, index + 1).join('/')
    }));
}

/* ------------------------------ 文件夹页的列表排序与日期 ------------------------------ */

/**
 * 标题比较：数字自然序、大小写不敏感。
 *
 * 写成**具名导出的函数**而不是页面里的顶层 const：`getStaticPaths` 会被 Astro 编译进
 * 单独的 chunk，那里只保留 import，页面顶层的 const 会变成「未定义」。
 */
export function compareGardenTitle(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export interface GardenDateInfo {
    year: string;
    /** `MM.DD`，与时间轴的 `.ledger-date-value` 一致 */
    mmdd: string;
    /** `YYYY-MM-DD`，给 `<time datetime>` */
    iso: string;
    weekday: string;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * frontmatter 的日期只有 `YYYY-MM-DD` 这一种可靠形态（带时分也取日期部分）；
 * 解析不出来就返回 null —— 列表里留空，不写「未知」。
 */
export function gardenDateInfoOf(raw?: string | null): GardenDateInfo | null {
    if (!raw) return null;
    const text = String(raw);
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return { year, mmdd: `${month}.${day}`, iso: `${year}-${month}-${day}`, weekday: WEEKDAYS[date.getDay()] };
}
