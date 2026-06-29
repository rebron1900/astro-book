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

        // 按创建时间排序
        return [...posts, ...memos].sort((a, b) => {
            // Memo 有 createdTs（秒），Post 有 created_at（ISO 字符串）
            // 用 `in` 收窄联合类型：仅 Memo 含 createdTs
            const aTime =
                'createdTs' in a ? a.createdTs * 1000 : new Date(a.created_at).getTime();
            const bTime =
                'createdTs' in b ? b.createdTs * 1000 : new Date(b.created_at).getTime();

            return bTime - aTime; // 降序排列（最新的在前）
        });
    } catch (error) {
        console.error('获取内容失败:', error);
        return [];
    }
}
