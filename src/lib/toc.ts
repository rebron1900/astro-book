import { parseHTML } from 'linkedom';

function tocGen(html) {
    if (!html) return '';

    const { document } = parseHTML(html);

    // 只查一次
    const headers = [...document.querySelectorAll('h2,h3,h4')].map((el) => ({
        level: Number(el.tagName.slice(1)),
        id: el.id || '',
        text: el.textContent.trim()
    }));

    if (!headers.length) return '';

    // 下面逻辑完全沿用你原来的 buf/stack 写法
    const stack = [];
    const buf = ['<ul>'];

    headers.forEach(({ level, id, text }) => {
        while (stack.length && stack.at(-1) >= level) {
            buf.push('</ul></li>');
            stack.pop();
        }
        buf.push(`<li><a href="#${id}">${text}</a>`);
        if (level < 4) {
            buf.push('<ul>');
            stack.push(level);
        } else {
            buf.push('</li>');
        }
    });

    while (stack.length) {
        buf.push('</ul></li>');
        stack.pop();
    }
    buf.push('</ul>');
    return buf.join('');
}

export default tocGen;
