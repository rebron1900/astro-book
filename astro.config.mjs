import { defineConfig } from 'astro/config';
import solidJs from '@astrojs/solid-js';
import sitemap from '@astrojs/sitemap';
import { execSync } from 'node:child_process';

// https://astro.build/config
export default defineConfig({
    site: 'https://1900.live',
    // 运动页已不再来自 Strava，旧地址保留一个静态跳转，避免以前分享出去的链接失效
    redirects: {
        '/strava/': '/exercise/'
    },
    experimental: {
        incrementalBuild: true
    },
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
