import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { settings, postsAll } from '../api/store';

const site = import.meta.env.SITE;
export async function GET(_context: APIContext) {
    if (!settings) {
        return new Response('settings not available', { status: 503 });
    }
    return rss({
        title: settings.title,
        description: settings.description,
        site: site,
        items: postsAll.slice(0, 30).map((item) => ({
            title: item.title,
            description: `${item.feature_image ? '<p><img src="' + item.feature_image + '"/> ' + item.feature_image_caption + ' </p>' : ''}${item.html}`,
            link: `/${item.slug}/`,
            pubDate: item.published_at ? new Date(item.published_at) : undefined
        }))
    });
}
