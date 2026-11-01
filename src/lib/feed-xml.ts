import { DOMParser, parseHTML } from 'linkedom';

export interface FeedXmlItem {
    title: string;
    url: string;
    published_at?: string;
}

function text(node: { textContent?: string | null } | null | undefined): string {
    return (node?.textContent || '').trim();
}

function itemDate(item: Element): string {
    const selectors = ['pubDate', 'published', 'updated', 'dc\\:date', 'date'];
    for (const selector of selectors) {
        const value = text(item.querySelector(selector));
        if (value) return value;
    }
    return '';
}

/**
 * 从 RSS 2.0 / Atom 的 XML 中读取第一条文章。
 *
 * 这是 Miniflux 的兜底：当 Miniflux 因条件请求缓存或历史清理拿不到 entries 时，
 * 同步脚本直接读取订阅源，避免把仍有文章的站点误判成「失联」。
 */
export function parseFeedXml(xml: string, baseUrl: string): FeedXmlItem | null {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');

    const items = [...doc.querySelectorAll('item')];
    const isRss = items.length > 0;
    const entries = isRss ? items : [...doc.querySelectorAll('entry')];
    if (entries.length === 0) return null;

    const item = entries[0];
    const title = text(item.querySelector('title')) || '(无标题)';

    let url = '';
    if (isRss) {
        url = text(item.querySelector('link')) || text(item.querySelector('guid'));
    } else {
        const links = [...item.querySelectorAll('link')];
        const link = links.find((node) => !node.getAttribute('rel') || node.getAttribute('rel') === 'alternate') || links.find((node) => node.getAttribute('href')) || links[0];
        url = link?.getAttribute('href') || '';
    }
    if (!url) url = text(item.querySelector('guid'));

    if (url) {
        try {
            url = new URL(url, baseUrl).href;
        } catch {
            // 保留原始链接，交给页面兜底
        }
    }

    const publishedAt = itemDate(item);
    return {
        title,
        url,
        ...(publishedAt ? { published_at: publishedAt } : {})
    };
}

/**
 * 从站点 HTML 的 <link rel="alternate"> 中找 RSS / Atom 地址。
 * 用于订阅源地址失效（404 / 站点换域名）但站点仍提供新订阅地址的情况。
 */
export function discoverFeedUrl(html: string, baseUrl: string): string | null {
    const { document } = parseHTML(html);
    const links = [...document.querySelectorAll('link[href]')];
    const candidates = links.filter((node) => {
        const type = node.getAttribute('type') || '';
        return /(rss|atom)\+xml/i.test(type);
    });
    const alternate = candidates.find((node) => (node.getAttribute('rel') || '').split(/\s+/).includes('alternate'));
    const href = (alternate || candidates[0])?.getAttribute('href');
    if (!href) return null;
    try {
        return new URL(href, baseUrl).href;
    } catch {
        return null;
    }
}
