import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import solidJs from '@astrojs/solid-js';
import compress from 'astro-compress';

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
        }),
        compress({
            Image: false,
            SVG: false
        })
    ]
});
