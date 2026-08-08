// 获取一个svg字符串
// import Fontmin from 'fontmin-esm';
export function getSvg(name: string = '', viewbox: string = '0 0 24 24', classes: string = 'book-icon'): string {
    return `
    <svg viewBox="${viewbox}" aria-hidden="true"${classes ? ` class="${classes}"` : ''}>
        <use xlink:href="/icons.svg#${name}"></use>
    </svg>
    `;
}

export interface GroupedMonth<T> {
    month: string;
    data: T[];
}

export interface GroupedYear<T> {
    year: string;
    data: GroupedMonth<T>[];
}

// 通用分组工具：按日期字符串前缀分组，先按年再按月，均降序
function groupByYearMonth<T>(data: T[], yearSlice: (item: T) => string, monthSlice: (item: T) => string): GroupedYear<T>[] {
    // 按年份分组
    const byYear: Record<string, T[]> = {};
    data.forEach((item) => {
        const year = yearSlice(item);
        (byYear[year] ??= []).push(item);
    });

    // 转换为年份分组数组，按年份降序
    return Object.entries(byYear)
        .map(([year, items]) => {
            // 按月份分组
            const byMonth: Record<string, T[]> = {};
            items.forEach((item) => {
                const month = monthSlice(item);
                (byMonth[month] ??= []).push(item);
            });

            // 转换为月份分组数组，按月份降序
            const months: GroupedMonth<T>[] = Object.entries(byMonth)
                .map(([month, v]) => ({ month, data: v }))
                .sort((a, b) => Number(b.month) - Number(a.month));

            return { year, data: months };
        })
        .sort((a, b) => Number(b.year) - Number(a.year));
}

export const doubanGroupByDate = <T extends { created_time: string }>(data: T[]): GroupedYear<T>[] => {
    return groupByYearMonth(
        data,
        (x) => x.created_time.substring(0, 4), // group by year
        (x) => x.created_time.substring(5, 7) // group by month
    );
};

// 定义一个函数来处理数据
// Ghost 的 published_at 为 string | null | undefined，这里放宽约束以兼容
export const groupByDate = <T extends { published_at?: string | null }>(data: T[]): GroupedYear<T>[] => {
    return groupByYearMonth(
        data,
        (x) => (x.published_at ?? '1970-01-01').substring(0, 4), // 按年份分组
        (x) => (x.published_at ?? '1970-01-01').substring(5, 7) // 按月份分组
    );
};

export function normalizeSlug(slug: string) {
    // 确保开头有斜杠
    if (!slug.startsWith('/')) {
        slug = '/' + slug;
    }

    // 确保结尾有斜杠
    if (!slug.endsWith('/')) {
        slug = slug + '/';
    }

    return slug;
}

/**
 * 相对时间（Threads 风格）：x 秒/分钟/小时/天前。
 * 超过 7 天显示具体日期（YYYY-MM-DD）。
 * 兼容秒/毫秒时间戳或 ISO 字符串。
 */
export function relativeTime(data: string | number | null | undefined): string {
    if (data == null) return '';
    let ts: number;
    if (typeof data === 'number' || /^\d+$/.test(data)) {
        const n = typeof data === 'number' ? data : parseInt(data, 10);
        ts = n > 999999999999 ? n : n * 1000;
    } else {
        ts = new Date(data).getTime();
    }
    if (isNaN(ts)) return '';
    const diff = Date.now() - ts;
    const min = 60 * 1000;
    const hr = 60 * min;
    const day = 24 * hr;
    if (diff < min) return '刚刚';
    if (diff < hr) return `${Math.floor(diff / min)} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hr)} 小时前`;
    if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

export function normalizeData(data: string | number | null | undefined): string | null {
    // 空值直接返回 null（Ghost 的 published_at 可能为 null/undefined）
    if (data == null) return null;
    try {
        let date: Date;

        // 处理 Unix 时间戳（数字或字符串形式的数字）
        if (typeof data === 'number' || /^\d+$/.test(data)) {
            const timestamp = typeof data === 'number' ? data : parseInt(data, 10);
            // 自动区分秒或毫秒（长度超过 12 位视为毫秒）
            date = new Date(timestamp > 999999999999 ? timestamp : timestamp * 1000);
        }
        // 处理字符串日期（ISO 格式、本地格式等）
        else {
            date = new Date(data);
        }

        // 检查日期有效性
        if (isNaN(date.getTime())) {
            console.error('Invalid date format:', data);
            return null;
        }

        // 返回 YYYY-MM-DD 格式
        return date.toISOString().split('T')[0];
    } catch (error) {
        console.error('Error normalizing date:', error);
        return '1900-01-01'; // 默认值
    }
}
// export function minfont(titleText: string) {
//     const fontmin = new Fontmin()
//         .src('src/font/SmileySans.ttf')
//         .use(
//             Fontmin.glyph({
//                 text: titleText,
//                 hinting: false
//             })
//         )
//         .dest('public');

//     fontmin.run((err, files) => {
//         if (err) throw err;
//         console.log('compress font success\n');
//     });
// }
