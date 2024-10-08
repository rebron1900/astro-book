import rss from '@astrojs/rss';
import { settings, postsAll } from '../data/ghost-store.ts';

const site = import.meta.env.SITE;
export async function GET(context) {
    return rss({
        title: settings.title,
        description: settings.description,
        site: site,
        items: postsAll.slice(0, 30).map((item) => ({
            title: item.title,
            description: item.html,
            link: `/${item.slug}/`,
            pubDate: item.published_at
        }))
    });
}
