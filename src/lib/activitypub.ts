import tippy from 'tippy.js';
import 'tippy.js/themes/light.css';
import { normalizeData } from './utils/help';
import cocoMessage from './coco-message';

// 配置常量
const API_ENDPOINT = 'https://hapi.190102.xyz:4433/blog/interactions';

interface InteractionUser {
    id?: string | number;
    avatar?: string;
    name?: string;
    username?: string;
    content?: string;
    created_at: string;
    author: { name?: string; avatar?: string };
}

interface InteractionStats {
    replies_count: number;
    favourites_count: number;
}

// 转义外部数据，防止 XSS。同时适用于 HTML 属性与文本上下文。
function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

interface InteractionData {
    toot_id: string;
    stats: InteractionStats;
    favourites: InteractionUser[];
    replies: InteractionUser[];
}

// 主入口函数
export default async function initActivityPubInteractions() {
    try {
        const container = document.querySelector<HTMLElement>('#activitypub');
        if (!container) {
            return;
        }

        const postId = container.dataset.postid;
        if (!postId) {
            container.remove();
            return;
        }

        const data = await fetchInteractions(postId);
        renderAllInteractions(data, container);

        // 如果有互动数据则显示容器
        if (data.stats.replies_count > 0 || data.stats.favourites_count > 0) {
            container.classList.add('loaded');
            const codeEl = document.querySelector<HTMLElement>('.social-note code');
            if (codeEl) codeEl.textContent += data.toot_id;
            cocoMessage.success('联邦宇宙互动加载成功 🎉！');
        } else {
            document.querySelector('.discussion-avatar-list')?.remove();
        }
    } catch (error) {
        document.querySelector('.discussion-avatar-list')?.remove();
        console.error('加载互动数据失败:', error);
    }
}

// 获取互动数据
async function fetchInteractions(postId: string): Promise<InteractionData> {
    const response = await fetch(`${API_ENDPOINT}?post_id=${postId}`);
    if (!response.ok) throw new Error('API请求失败');
    return await response.json();
}
// 渲染所有互动（混合点赞和评论）
function renderAllInteractions(data: InteractionData, container: HTMLElement) {
    const avatarList = container.querySelector<HTMLElement>('.discussion-avatar-list');
    if (!avatarList) return;

    avatarList.innerHTML = '';

    // 合并点赞和评论数据
    const allInteractions: Array<InteractionUser & { type: string }> = [
        ...data.favourites.map((user) => ({ ...user, type: 'like' })),
        ...data.replies.map((user) => ({ ...user, type: 'reply' }))
    ];

    // 按时间排序（最新的在前）
    allInteractions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    allInteractions.forEach((user) => {
        const li = document.createElement('li');
        li.innerHTML = `
      <div class="comment-user-avatar ${user.type}">
        <img src="${escapeHtml(user.avatar || user.author.avatar)}"
             alt="${escapeHtml(user.name || user.username)}"
             class="avatar avatar-60 photo"
             loading="lazy"
             data-user-id="${escapeHtml(user.id)}"
             data-type="${user.type}">
      </div>
    `;
        avatarList.appendChild(li);

        // 直接在这里初始化 Tippy
        const img = li.querySelector<HTMLImageElement>('img');
        if (!img) return;
        if (user.type === 'reply') {
            // 评论工具提示
            tippy(img, {
                theme: 'light',
                allowHTML: true,
                interactive: true,
                maxWidth: 350,
                delay: [100, 0],
                content: '加载中...',
                onShow(instance) {
                    instance.setContent(
                        `${escapeHtml(user.content)} <hr style="border: solid 1px var(--gray-200);" /><div class="text-right">by ${escapeHtml(user.author.name)} <em>${normalizeData(user.created_at)}</em></div>`
                    );
                }
                //测试
            });
        } else {
            // 点赞工具提示
            tippy(img, {
                allowHTML: true,
                content: `by ${escapeHtml(user.name)} 💖`,
                delay: [100, 0]
            });
        }
    });

    // 更新统计信息
}
