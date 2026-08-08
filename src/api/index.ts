export * from './ghost';
export * from './memos';
export * from './neodb';
export * from './flux';
export * from './types';

// 整合内容源（原 getAllContent）
import { getAllPosts } from './ghost';
import { getMemos } from './memos';

export async function getAllContent(
    posts?: Awaited<ReturnType<typeof getAllPosts>>,
    memos?: Awaited<ReturnType<typeof getMemos>>
) {
    try {
        const [postData, memoData] = await Promise.all([
            posts ?? getAllPosts(),
            memos ?? getMemos()
        ]);
        // 按创建时间排序
        return [...postData, ...memoData].sort((a, b) => {
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
