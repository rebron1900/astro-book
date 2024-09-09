import rss from '@astrojs/rss';
import { settings, postsAll } from '../data/ghost-store.ts';

export async function GET(context) {
    return rss({
        title: settings.title,
        description: settings.description,
        site: settings.url,
        items: postsAll.map((item) => ({
            title: item.title,
            description: item.excerpt,
            link: `/${item.slug}/`,
            pubDate: item.published_at
        }))
    });
}
