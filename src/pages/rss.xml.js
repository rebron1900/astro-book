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
            description: `${item.feature_image ? '<p><img src="' + item.feature_image + '"/> ' + item.feature_image_caption + ' </p>' : ''}${item.html}`,
            link: `/${item.slug}/`,
            pubDate: item.published_at
        }))
    });
}
