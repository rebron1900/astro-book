import { postsAll } from '../data/ghost-store.ts';

export async function GET(context) {
    const postsdata = postsAll.map((item) => ({
        title: item.title,
        description: item.excerpt,
        link: `/blog/${item.slug}/`,
        pubDate: item.published_at
    }));
    return new Response(JSON.stringify(postsAll));
}
