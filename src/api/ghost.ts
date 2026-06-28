import type { Page, Post } from '@ts-ghost/content-api';
import { TSGhostContentAPI } from '@ts-ghost/content-api';
import type { DataSource } from './types';

const ghostUrl = import.meta.env.GHOST_API_URL;
const ghostApiKey = import.meta.env.GHOST_API_KEY;
const postLimit = import.meta.env.GHOST_API_POST_LIMIT;

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

// DataSource 适配器：让 ghost-posts 可通过注册器统一管理
export const ghostSource: DataSource<Post[]> = {
    name: 'ghost-posts',
    fetch: getAllPosts
};
