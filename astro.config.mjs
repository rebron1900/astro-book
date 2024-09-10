import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import solidJs from '@astrojs/solid-js';
import expressiveCode from 'astro-expressive-code';

import purgecss from 'astro-purgecss';

// https://astro.build/config
export default defineConfig({
    site: 'https://1900.live',
    build: {
        inlineStylesheets: 'never'
    },
    // redirects: {
    //     '/rss/': '/rss.xml',
    //     '/404/': '/404.html',
    //     '/505/': '/505.html'
    // },
    integrations: [
        sitemap(),
        solidJs({
            devtools: true
        }),
        expressiveCode({
            // You can set configuration options here
            themes: ['dracula', 'github-light'],
            styleOverrides: {
                // You can also override styles
                borderRadius: '0.5rem',
                frames: {
                    shadowColor: '#124'
                }
            }
        })
        // purgecss({
        //     fontFace: true,
        //     keyframes: true,
        //     content: [process.cwd() + '/src/**/*.{astro,jsx}']
        // })
    ]
});
