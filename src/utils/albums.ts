import { postsAll } from '../data/ghost-store.js';

export interface AlbumImage {
    url: string;
    alt?: string;
    caption?: string;
}

export interface Album {
    name: string;
    slug: string;
    images: AlbumImage[];
    coverImages: AlbumImage[];
    postCount: number;
    posts: any[];
    tag: any;
    createdAt: Date;
    updatedAt: Date;
}

export function extractAlbumsFromPosts() {
    const albums: Map<string, Album> = new Map();

    // 遍历所有文章，查找带有相册标签的文章
    postsAll.forEach((post) => {
        if (!post.tags) return;

        // 查找相册标签（格式：#相册-相册名称）
        const albumTags = post.tags.filter((tag) => tag.name.startsWith('相册-') || tag.name.startsWith('#相册-'));

        albumTags.forEach((tag) => {
            // 提取相册名称
            const albumName = tag.name.replace(/^#?相册-/, '');
            const albumSlug = albumName.toLowerCase().replace(/\s+/g, '-');

            if (!albums.has(albumSlug)) {
                albums.set(albumSlug, {
                    name: albumName,
                    slug: albumSlug,
                    images: [],
                    coverImages: [],
                    postCount: 0,
                    posts: [],
                    tag: tag,
                    createdAt: new Date(post.created_at),
                    updatedAt: new Date(post.updated_at)
                });
            }

            const album = albums.get(albumSlug)!;

            // 提取文章中的图片
            const images = extractImagesFromPost(post);
            album.images.push(...images);

            // 更新相册信息
            album.postCount++;
            album.posts.push(post);
            album.updatedAt = new Date(post.updated_at);

            // 如果创建时间更早，更新创建时间
            if (new Date(post.created_at) < album.createdAt) {
                album.createdAt = new Date(post.created_at);
            }
        });
    });

    // 为每个相册选择封面图片（最多3张）
    albums.forEach((album) => {
        album.coverImages = album.images.slice(0, 3);
    });

    // 按创建时间排序
    return Array.from(albums.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function extractImagesFromPost(post: any): AlbumImage[] {
    const images: AlbumImage[] = [];

    // 从文章内容中提取图片
    if (post.html) {
        // 匹配 <img> 标签
        const imgRegex = /<img[^>]*src="([^"]*)"[^>]*(?:alt="([^"]*)"[^>]*)?(?:caption="([^"]*)"[^>]*)?[^>]*>/gi;
        let match;

        while ((match = imgRegex.exec(post.html)) !== null) {
            images.push({
                url: match[1],
                alt: match[2] || undefined,
                caption: match[3] || undefined
            });
        }

        // 匹配 Markdown 图片语法 ![alt](url "caption")
        const mdRegex = /!\[([^\]]*)\]\(([^"\)]*)(?:\s+"([^"]*)")?\)/gi;
        while ((match = mdRegex.exec(post.html)) !== null) {
            images.push({
                url: match[2],
                alt: match[1] || undefined,
                caption: match[3] || undefined
            });
        }
    }

    // 从 feature_image 提取
    if (post.feature_image) {
        images.unshift({
            url: post.feature_image,
            alt: post.feature_image_alt || undefined,
            caption: post.feature_image_caption || undefined
        });
    }

    return images;
}

export function getAlbumBySlug(slug: string) {
    const albums = extractAlbumsFromPosts();
    return albums.find((album) => album.slug === slug);
}
