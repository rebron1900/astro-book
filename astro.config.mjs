import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import solidJs from '@astrojs/solid-js';
import expressiveCode from 'astro-expressive-code';
import compress from 'astro-compress';

// https://astro.build/config
export default defineConfig({
    site: 'https://1900.live',
    redirects: {
        '/rss': {
            status: 302,
            destination: '/rss.xml'
        }
    },
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
        }),
        compress({
            Image: false,
            SVG: false
        })
    ]
});
