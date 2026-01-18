import type { Page, Post } from '@ts-ghost/content-api';

import { TSGhostContentAPI } from '@ts-ghost/content-api';
import config from '../data/config';

const ghostUrl = import.meta.env.GHOST_API_URL;
const ghostApiKey = import.meta.env.GHOST_API_KEY;
const postLimit = import.meta.env.GHOST_API_POST_LIMIT;
const neodbURL = import.meta.env.NEODB_URL;
const fluxURL = import.meta.env.FLUX_URL;
const fluxKey = import.meta.env.FLUX_KEY;

export interface ExPost extends Post {
    type: string;
}

export const getAllAuthors = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const results = await api.authors
        .browse()
        .include({
            'count.posts': true
        })
        .fetch();
    if (!results.success) {
        throw new Error(results.errors.map((e) => e.message).join(', '));
    }
    return {
        authors: results.data,
        meta: results.meta
    };
};

export const getPosts = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const results = await api.posts
        .browse()
        .include({
            authors: true,
            tags: true
        })
        .fetch();
    if (!results.success) {
        throw new Error(results.errors.map((e) => e.message).join(', '));
    }
    return {
        posts: results.data,
        meta: results.meta
    };
};

export const getAllPosts = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const posts: Post[] = [];
    let cursor = await api.posts
        .browse()
        .include({
            authors: true,
            tags: true
        })
        .paginate();
    if (cursor.current.success) posts.push(...cursor.current.data);
    while (cursor.next && posts.length < postLimit) {
        cursor = await cursor.next.paginate();
        if (cursor.current.success) posts.push(...cursor.current.data);
    }

    return posts.map((post) => ({
        ...post,
        type: 'post' // 为 Ghost 文章添加 type 属性
    }));
};

export const getAllPages = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const pages: Page[] = [];
    let cursor = await api.pages
        .browse()
        .include({
            authors: true,
            tags: true
        })
        .paginate();
    if (cursor.current.success) pages.push(...cursor.current.data);
    while (cursor.next) {
        cursor = await cursor.next.paginate();
        if (cursor.current.success) pages.push(...cursor.current.data);
    }

    const pagesWithType = pages.map((page) => ({
        ...page,
        type: 'page' // 设置 type 字段的值
    }));

    return pagesWithType;
};

export const getSettings = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const res = await api.settings.fetch();
    if (res.success) {
        return res.data;
    }
    return null;
};
export type NonNullable<T> = T extends null | undefined ? never : T;

export type Settings = NonNullable<Awaited<ReturnType<typeof getSettings>>>;

export const getAllTags = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const results = await api.tags
        .browse({ limit: 'all', order: 'count.posts desc' })
        .include({
            'count.posts': true
        })
        .fetch();
    if (!results.success) {
        throw new Error(results.errors.map((e) => e.message).join(', '));
    }
    //
    const postsAll = await getAllPosts();

    const tagsWithPost = results.data.map((tag) => {
        const posts = postsAll.filter((post) => {
            return post.tags && post.tags.some((tagItem) => tagItem.slug === tag.slug);
        });

        return { ...tag, posts: posts };
    });

    return tagsWithPost;
};

export const getNeodb = async () => {
    const res = await fetch(neodbURL);
    if (!res.ok) throw new Error(`NeoDB ${res.status} ${res.statusText}`);
    return res.json();
};

export async function getFlux() {
    try {
        // 第一步：获取所有feeds
        const feedsResponse = await fetch(`${fluxURL}/categories/4/feeds`, {
            method: 'GET',
            headers: {
                'X-Auth-Token': fluxKey
            }
        });

        if (!feedsResponse.ok) {
            throw new Error(`HTTP error! status: ${feedsResponse.status}`);
        }

        const feedsData = await feedsResponse.json();
        const feeds = feedsData.feeds || feedsData;

        // 第二步：获取每个feed的最新文章
        const feedPromises = feeds.map(async (feed) => {
            try {
                // 使用limit=1和order参数直接获取最新一条数据
                const entriesResponse = await fetch(`${fluxURL}/feeds/${feed.id}/entries?limit=1&order=published_at&direction=desc`, {
                    method: 'GET',
                    headers: {
                        'X-Auth-Token': fluxKey
                    }
                });

                if (!entriesResponse.ok) {
                    console.warn(`无法获取feed ${feed.id} 的entries: ${entriesResponse.status}`);
                    return null;
                }

                const entriesData = await entriesResponse.json();
                const entries = entriesData.entries || entriesData;

                // 获取最新文章
                if (entries.length > 0) {
                    const latestEntry = entries[0];
                    const domain = new URL(feed.site_url).origin;
                    const updateTime = new Date(latestEntry.published_at || latestEntry.created_at || latestEntry.date).getTime();

                    return {
                        ...latestEntry,
                        feed_id: feed.id,
                        feed: {
                            ...feed,
                            site_url: domain
                        },
                        // 添加更新时间戳用于排序
                        update_timestamp: updateTime
                    };
                }

                // 如果没有文章，返回null
                return null;
            } catch (error) {
                console.error(`获取feed ${feed.id} 数据时出错:`, error);
                return null;
            }
        });

        // 等待所有feed的请求完成
        const results = await Promise.all(feedPromises);

        // 过滤掉null值（只返回有文章的feed）
        const validEntries = results.filter((entry) => entry !== null);

        // 按更新时间排序（最新的在前）
        validEntries.sort((a, b) => {
            const timeA = a.update_timestamp || 0;
            const timeB = b.update_timestamp || 0;
            return timeB - timeA; // 降序排列
        });

        return validEntries;
    } catch (error) {
        console.error('请求错误:', error);
        return []; // Return an empty array or handle the error as needed
    }
}
export async function getMemos() {
    const memos = await fetch(config.memos.url).then((res) => res.json());
    return memos.map((memo: any) => ({
        ...memo,
        type: 'memo' // 为 Memos 添加 type 属性
    }));
}

// 整合两个数据源的函数
export async function getAllContent() {
    try {
        const [posts, memos] = await Promise.all([getAllPosts(), getMemos()]);

        // 按创建时间排序（假设都有 createdAt 字段）
        return [...posts, ...memos].sort((a, b) => {
            // 获取a的时间戳
            const aTime =
                a.type === 'post'
                    ? new Date(a.created_at).getTime() // Ghost文章使用created_at
                    : a.createdTs * 1000; // Memos使用createdTs（秒转毫秒）

            // 获取b的时间戳
            const bTime =
                b.type === 'post'
                    ? new Date(b.created_at).getTime() // Ghost文章使用created_at
                    : b.createdTs * 1000; // Memos使用createdTs（秒转毫秒）

            return bTime - aTime; // 降序排列（最新的在前）
        });
    } catch (error) {
        console.error('获取内容失败:', error);
        return [];
    }
}
