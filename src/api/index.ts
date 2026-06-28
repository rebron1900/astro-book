export * from './ghost';
export * from './memos';
export * from './neodb';
export * from './flux';
export * from './types';
export * from './registry';

// 整合内容源（原 getAllContent）
import { getAllPosts } from './ghost';
import { getMemos } from './memos';

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
