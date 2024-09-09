import _ from 'lodash-es'; // 获取一个svg字符串
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
