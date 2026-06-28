import _ from 'lodash-es'; // 获取一个svg字符串
// import Fontmin from 'fontmin-esm';
export function getSvg(name: string = '', viewbox: string = '0 0 24 24', classes: string = 'book-icon'): string {
    return `
    <svg viewBox="${viewbox}" aria-hidden="true"${classes ? ` class="${classes}"` : ''}>
        <use xlink:href="/icons.svg#${name}"></use>
    </svg>
    `;
}

export const doubanGroupByDate = (data) => {
    let result = _(data)
        .groupBy((x) => x.created_time.substring(0, 4)) // group by year
        .map((value, key) => ({
            year: key,
            data: _(value)
                .groupBy((x) => x.created_time.substring(5, 7)) // group by month
                .map((v, k) => ({ month: k, data: v }))
                .orderBy(['month'], ['desc'])
                .value() // formate month data
        }))
        .orderBy(['year'], ['desc'])
        .value();

    return result;
};

// 定义一个函数来处理数据
export const groupByDate = (data) => {
    // 先按照年份分组
    const result = _(data)
        .groupBy((x) => x.published_at.substring(0, 4)) // 按年份分组
        .map((value, key) => ({
            year: key,
            data: _(value)
                .groupBy((x) => x.published_at.substring(5, 7)) // 按月份分组
                .map((v, k) => ({ month: k, data: v }))
                .orderBy(['month'], ['desc'])
                .value() // 格式化月份数据
        }))
        .orderBy(['year'], ['desc'])
        .value();

    return result;
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

export function normalizeData(data: string | number): string | null {
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
