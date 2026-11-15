/**
 * 给正文链接打「站内 / 站外」标记，供 `.garden-note` 用不同样式区分。
 *
 * 只判断、不改 href：站内链（`/garden/...`、相对路径、本站绝对地址）加
 * `link-internal`，其余（http(s) 外链、mailto、tel 等）加 `link-external`。
 * 样式只在花园正文作用域内生效，博客不受影响。
 */
import { defineMdastPlugin } from 'satteri';

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

/** 把站点地址归一成 origin；配置里写不写结尾斜杠都能用 */
const originOf = (site) => {
    if (!site) return '';
    try {
        return new URL(site).origin;
    } catch {
        return '';
    }
};

const isInternal = (url, origin) => {
    if (!url) return false;
    // 协议相对地址（//example.com/x）按外链处理，除非就是本站
    if (url.startsWith('//')) {
        return Boolean(origin) && url.startsWith(`//${new URL(origin).host}`);
    }
    if (!ABSOLUTE.test(url)) return true; // /path、./path、../path、path
    try {
        return Boolean(origin) && new URL(url).origin === origin;
    } catch {
        return false;
    }
};

export const satteriLinkClasses = (options = {}) => {
    const origin = originOf(options.site);

    return defineMdastPlugin({
        name: 'link-classes',
        link(node, ctx) {
            const url = typeof node.url === 'string' ? node.url.trim() : '';
            // 页内锚点不参与：它既不是站内笔记链，也不该带外链箭头
            if (!url || url.startsWith('#')) return;

            const className = isInternal(url, origin) ? 'link-internal' : 'link-external';
            const data = node.data ?? {};
            const properties = data.hProperties ?? {};
            const existing = properties.className ?? properties.class ?? [];
            const classes = Array.isArray(existing) ? existing : String(existing).split(/\s+/);
            ctx.setProperty(node, 'data', {
                ...data,
                hProperties: {
                    ...properties,
                    className: [...classes.filter(Boolean), className]
                }
            });
        }
    });
};
