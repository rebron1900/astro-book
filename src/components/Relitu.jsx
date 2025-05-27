// src/components/DateGrid.jsx
import { postsAll } from '../data/ghost-store';
import { normalizeSlug, normalizeData } from '../utils/help';

function parseDate(str) {
    return new Date(str);
}

function getThisSunday(date) {
    const dayOfWeek = date.getDay();
    const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const thisSunday = new Date(date);
    thisSunday.setDate(thisSunday.getDate() + daysToSunday);
    return thisSunday;
}

const calculateTextLength = (htmlString) => {
    // 使用正则表达式去除 HTML 标签
    const textContent = htmlString.replace(/<[^>]*>/g, '');
    return textContent.trim().length; // 返回文字数量
};

function dateBuild(data, today) {
    const dateCounts = {};
    data.forEach((item) => {
        const dateStr = normalizeData(item.published_at);
        dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
    });

    const result = [];
    const sunday = getThisSunday(today);
    let startDate = new Date(sunday);
    startDate.setDate(sunday.getDate() - 62);

    for (let currentDate = sunday; currentDate >= startDate; currentDate.setDate(currentDate.getDate() - 1)) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const count = dateCounts[dateStr] || 0;
        const dataContent = data.filter((item) => normalizeData(item.published_at) === dateStr);

        result.push({
            date: dateStr,
            count: count,
            data: dataContent,
            wordcount: dataContent.reduce((total, item) => {
                return total + calculateTextLength(item.html);
            }, 0)
        });
    }

    return result;
}

const DateGrid = () => {
    const today = new Date();
    const builtData = dateBuild(postsAll, today);

    const columns = () => {
        const cols = [];
        const items = builtData.slice().reverse();

        for (let i = 0; i < items.length; i += 7) {
            cols.push(items.slice(i, i + 7)); // 每列最多7个项目
        }

        return cols;
    };

    return (
        <div class='toc-relitu'>
            <strong>热力图</strong>
            <div id='relitu-container' class='relitu-container'>
                {columns().map((column, colIndex) => (
                    <div class='grid-column' key={colIndex}>
                        {column.map((article, index) => {
                            const tooltipStr = article.data.map((item) => `- <a href='${normalizeSlug(item.slug)}'>${item.title}</a></br>`).join(' ');
                            const currentStyle = article.date === new Date().toISOString().split('T')[0] ? 'current-item' : '';

                            return (
                                <div class='grid-item'>
                                    <div
                                        role='link'
                                        title={`${article.date}，共 ${article.count} 篇，共 ${article.wordcount} 字`}
                                        style={article.wordcount !== 0 ? `background-color:rgba(77, 208, 90,${article.wordcount / 5000 + 0.2})` : ''}
                                        class={`item-info ${currentStyle}`}
                                        data-tippy-content={`${article.date}，共 ${article.count} 篇，共 ${article.wordcount} 字<br />${tooltipStr}`}
                                        data-date={article.date}
                                        key={index}
                                    ></div>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            <div class='relitu-count'>
                写写停停，博主已记录 <strong>{postsAll.length}</strong> 篇文章!{' '}
            </div>
        </div>
    );
};

export default DateGrid;
