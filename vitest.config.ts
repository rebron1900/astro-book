import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/helpers/setup.ts']
    },
    define: {
        'import.meta.env.NEODB_URL': JSON.stringify('https://neodb.test.com/api'),
        'import.meta.env.FLUX_URL': JSON.stringify('https://flux.test.com'),
        'import.meta.env.FLUX_KEY': JSON.stringify('test-flux-key'),
        'import.meta.env.SITE': JSON.stringify('https://test.1900.live'),
        'import.meta.env.CDN_URL': JSON.stringify('https://cdn.test.com'),
        'import.meta.env.MAP_URL': JSON.stringify('https://map.test.com'),
        'import.meta.env.MAP_KEY': JSON.stringify('test-map-key')
    }
});
