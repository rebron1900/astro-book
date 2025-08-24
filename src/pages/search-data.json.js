import { postsAll } from '../utils/ghost-store.ts';
import { normalizeSlug, normalizeData } from '../utils/help.ts';

export async function GET(context) {
    const postsdata = postsAll.map((item, index) => ({
        id: index,
        href: normalizeSlug(item.slug),
        date: normalizeData(item.published_at),
        title: item.title,
        section: item.tags.map((tag) => tag.name).join(','),
        published: normalizeData(item.published_at),
        word_count: item.html.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length,
        content: item.html.replace(/<[^>]*>/g, '').replace(/\s+/g, '')
    }));
    return new Response(JSON.stringify(postsdata));
}
