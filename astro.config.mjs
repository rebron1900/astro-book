import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import solidJs from '@astrojs/solid-js';

// https://astro.build/config
export default defineConfig({
    site: 'https://1900.live',
    markdown: {
        shikiConfig: {
            theme: 'dracula',
            themes: {
                light: 'github-light',
                dark: 'github-dark'
            }
        }
    },
    integrations: [
        sitemap(),
        solidJs({
            devtools: true
        })
    ],
    hooks: {
        'astro:build:done': (html) => {
            // 使用 DOMParser 解析 HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 修改所有外部链接
            const links = doc.querySelectorAll('a[href]');
            links.forEach((link) => {
                const href = link.getAttribute('href');
                if (href && !href.startsWith('#') && !href.startsWith('/')) {
                    // 判断是否为外部链接
                    if (new URL(href, location.href).origin !== location.origin) {
                        // 附加原始链接作为参数
                        link.setAttribute('href', `https://your-redirect-domain.com?url=${encodeURIComponent(href)}`);
                    }
                }
            });

            // 将修改后的 HTML 转换为字符串
            return new XMLSerializer().serializeToString(doc);
        }
    }
});
