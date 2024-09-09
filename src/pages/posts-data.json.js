import { postsAll } from '../data/ghost-store.ts';
import { normalizeSlug } from '../utils/help.ts';

export async function GET(context) {
    const postsdata = postsAll.map((item) => ({
        title: item.title,
        description: item.excerpt,
        link: `/blog${normalizeSlug(item.slug)}/`,
        pubDate: item.published_at
    }));
    return new Response(JSON.stringify(postsAll));
}
