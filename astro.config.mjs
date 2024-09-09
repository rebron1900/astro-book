import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import solidJs from '@astrojs/solid-js';

import expressiveCode from 'astro-expressive-code';

// https://astro.build/config
export default defineConfig({
    site: 'https://1900.live',
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
    ]
});
