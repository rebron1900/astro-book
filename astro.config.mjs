import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import solidJs from '@astrojs/solid-js';
import compress from 'astro-compress';

// https://astro.build/config
export default defineConfig({
    site: 'https://1900.live',
    markdown: {
        shikiConfig: {
            // Choose from Shiki's built-in themes (or add your own)
            // https://shiki.style/themes
            theme: 'dracula',
            // Alternatively, provide multiple themes
            // See note below for using dual light/dark themes
            themes: {
                light: 'github-light',
                dark: 'github-dark'
            },
            // Disable the default colors
            // https://shiki.style/guide/dual-themes#without-default-color
            // (Added in v4.12.0)
            defaultColor: false,
            // Add custom languages
            // Note: Shiki has countless langs built-in, including .astro!
            // https://shiki.style/languages
            langs: [],
            // Enable word wrap to prevent horizontal scrolling
            wrap: true,
            // Add custom transformers: https://shiki.style/guide/transformers
            // Find common transformers: https://shiki.style/packages/transformers
            transformers: []
        }
    },
    integrations: [
        sitemap(),
        solidJs({
            devtools: true
        }),
        // expressiveCode({
        //     // You can set configuration options here
        //     themes: ['dracula', 'github-light'],
        //     styleOverrides: {
        //         // You can also override styles
        //         borderRadius: '0.5rem',
        //         frames: {
        //             shadowColor: '#124'
        //         }
        //     }
        // }),
        compress({
            Image: false,
            SVG: false
        })
    ]
});
