import rss from '@astrojs/rss';
import { settings, postsAll } from '../data/ghost-store.ts';

export async function GET(context) {
    return rss({
        title: settings.title,
        description: settings.description,
        site: Astro.site,
        follow_challenge: {
            feedId: '41342818716915717',
            userId: '41422934521641984'
        },
        items: postsAll.slice(0, 30).map((item) => ({
            title: item.title,
            description: item.html,
            link: `/${item.slug}/`,
            pubDate: item.published_at
        }))
    });
}
