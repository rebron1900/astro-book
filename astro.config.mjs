import { defineConfig } from 'astro/config';
import solidJs from '@astrojs/solid-js';
import sitemap from '@astrojs/sitemap';
import { execSync } from 'node:child_process';

// https://astro.build/config
export default defineConfig({
    site: 'https://1900.live',
    trailingSlash: 'always', // 关键行
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
