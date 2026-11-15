import { defineConfig } from 'astro/config';
import solidJs from '@astrojs/solid-js';
import sitemap from '@astrojs/sitemap';
import { execSync } from 'node:child_process';
import { satteri } from '@astrojs/markdown-satteri';
import { satteriCallouts } from './src/lib/markdown/satteri-callouts.mjs';
import { satteriLinkClasses } from './src/lib/markdown/satteri-links.mjs';

const SITE = 'https://1900.live';

// https://astro.build/config
export default defineConfig({
    site: SITE,
    // 运动页已并入 /activity/，旧地址保留静态跳转，避免以前分享出去的链接失效
    redirects: {
        '/strava/': '/activity/',
        '/exercise/': '/activity/',
        '/exercise/footprint/': '/activity/'
    },
    experimental: {
        incrementalBuild: true
    },
    markdown: {
        // 默认处理器就是 Sätteri；这里显式传一次，只为挂 callout 的 mdast 插件
        processor: satteri({ mdastPlugins: [satteriCallouts, satteriLinkClasses({ site: SITE })] }),
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
            devtools: false
        })
    ],
    vite: {
        build: {
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (id.includes('node_modules')) {
                            return id.toString().split('node_modules/')[1].split('/')[0].toString();
                        }
                    }
                }
            }
        }
    }
});
