import { describe, it, expect } from 'vitest';
import { discoverFeedUrl, parseFeedXml } from '../../src/lib/feed-xml';

describe('parseFeedXml', () => {
    it('解析 RSS 2.0：标题、链接、pubDate', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0">
                <channel>
                    <title>Example</title>
                    <item>
                        <title><![CDATA[第一篇文章 & 测试]]></title>
                        <link>https://example.com/posts/1</link>
                        <pubDate>Tue, 27 Oct 2026 00:00:00 GMT</pubDate>
                    </item>
                    <item><title>更旧的文章</title><link>https://example.com/posts/0</link></item>
                </channel>
            </rss>`;

        expect(parseFeedXml(xml, 'https://example.com/feed.xml')).toEqual({
            title: '第一篇文章 & 测试',
            url: 'https://example.com/posts/1',
            published_at: 'Tue, 27 Oct 2026 00:00:00 GMT'
        });
    });

    it('解析 Atom：link href、published', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
                <title>Example Atom</title>
                <entry>
                    <title>Atom 文章</title>
                    <link rel="alternate" href="https://example.com/atom/1" />
                    <published>2026-10-20T08:00:00Z</published>
                </entry>
            </feed>`;

        expect(parseFeedXml(xml, 'https://example.com/atom.xml')).toEqual({
            title: 'Atom 文章',
            url: 'https://example.com/atom/1',
            published_at: '2026-10-20T08:00:00Z'
        });
    });

    it('相对链接按订阅源地址补全，并支持 dc:date', () => {
        const xml = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/">
            <channel><item>
                <title>相对链接</title>
                <link>/posts/relative</link>
                <dc:date>2026-06-28T12:25:59+08:00</dc:date>
            </item></channel>
        </rss>`;

        expect(parseFeedXml(xml, 'https://example.com/feed/')).toMatchObject({
            url: 'https://example.com/posts/relative',
            published_at: '2026-06-28T12:25:59+08:00'
        });
    });

    it('没有 item / entry 时返回 null', () => {
        expect(parseFeedXml('<rss><channel><title>Empty</title></channel></rss>', 'https://example.com/feed')).toBeNull();
    });
});

describe('discoverFeedUrl', () => {
    it('从站点 HTML 的 alternate link 发现 RSS 地址', () => {
        const html = `<html><head>
            <link rel="alternate" type="application/rss+xml" title="RSS" href="/rss.xml">
        </head></html>`;
        expect(discoverFeedUrl(html, 'https://example.com/posts/1')).toBe('https://example.com/rss.xml');
    });

    it('优先使用 atom/rss type 的 alternate link', () => {
        const html = `<html><head>
            <link rel="stylesheet" href="/style.css">
            <link rel="alternate" type="application/atom+xml" href="https://feeds.example.com/atom.xml">
        </head></html>`;
        expect(discoverFeedUrl(html, 'https://example.com')).toBe('https://feeds.example.com/atom.xml');
    });

    it('没有订阅 link 时返回 null', () => {
        expect(discoverFeedUrl('<html><head><link rel="stylesheet" href="/a.css"></head></html>', 'https://example.com')).toBeNull();
    });
});
