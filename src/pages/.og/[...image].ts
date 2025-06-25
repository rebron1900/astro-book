import { pages as gpages, postsAll, settings } from '../../data/ghost-store.js';
import { OGImageRoute } from 'astro-og-canvas';

const posts = postsAll.concat(gpages);

const pages = Object.fromEntries(
    posts.map((post) => [
        post.id,
        {
            title: post.title,
            description: post.excerpt
        }
    ])
);

// Configure Open Graph image generation route
export const { getStaticPaths, GET } = OGImageRoute({
    param: 'image',
    pages,
    getImageOptions: (_path, page) => ({
        title: page.title,
        description: page.description,
        logo: {
            path: './public/favicon.svg', // Required local path and PNG format
            size: [250]
        },
        border: {
            color: [242, 241, 245],
            width: 20
        },
        font: {
            title: {
                families: ['Noto Sans SC'], // or Noto Serif SC
                weight: 'Bold',
                color: [34, 33, 36],
                lineHeight: 1.5
            },
            description: {
                families: ['Noto Sans SC'], // or Noto Serif SC
                color: [72, 71, 74],
                lineHeight: 1.5
            }
        },
        fonts: [
            'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf',
            'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf'
            // 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Serif/SubsetOTF/SC/NotoSerifSC-Bold.otf',
            // 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf',
        ],
        bgGradient: [[242, 241, 245]]
    })
});
