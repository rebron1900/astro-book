import tippy from 'tippy.js';
import 'tippy.js/themes/light.css';
import { normalizeData } from '../utils/help';

// 配置常量
const API_ENDPOINT = 'https://hapi.190102.xyz:4433/blog/interactions';

// 主入口函数
export default async function initActivityPubInteractions() {
    try {
        const container = document.querySelector('#activitypub');
        if (!container) {
            return;
        }

        const postId = container.dataset.postid;
        if (!postId) {
            document.querySelector('#activitypub').remove();
            return;
        }

        const data = await fetchInteractions(postId);
        renderAllInteractions(data, container);

        // 如果有互动数据则显示容器
        if (data.stats.replies_count > 0 || data.stats.favourites_count > 0) {
            container.classList.add('loaded');
            document.querySelector('.social-note code').textContent += data.toot_id;
            cocoMessage.success('联邦宇宙互动加载成功 🎉！');
        } else {
            document.querySelector('.discussion-avatar-list').remove();
        }
    } catch (error) {
        document.querySelector('.discussion-avatar-list').remove();
        console.error('加载互动数据失败:', error);
    }
}

// 获取互动数据
async function fetchInteractions(postId) {
    const response = await fetch(`${API_ENDPOINT}?post_id=${postId}`);
    if (!response.ok) throw new Error('API请求失败');
    return await response.json();
}
// 渲染所有互动（混合点赞和评论）
function renderAllInteractions(data, container) {
    const avatarList = container.querySelector('.discussion-avatar-list');
    if (!avatarList) return;

    avatarList.innerHTML = '';

    // 合并点赞和评论数据
    const allInteractions = [...data.favourites.map((user) => ({ ...user, type: 'like' })), ...data.replies.map((user) => ({ ...user, type: 'reply' }))];

    // 按时间排序（最新的在前）
    allInteractions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    allInteractions.forEach((user) => {
        const li = document.createElement('li');
        li.innerHTML = `
      <div class="comment-user-avatar ${user.type}">
        <img src="${user.avatar || user.author.avatar}" 
             alt="${user.name || user.username}" 
             class="avatar avatar-60 photo" 
             loading="lazy"
             data-user-id="${user.id}"
             data-type="${user.type}">
      </div>
    `;
        avatarList.appendChild(li);

        // 直接在这里初始化 Tippy
        const img = li.querySelector('img');
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
                        `${user.content} <hr style="border: solid 1px var(--gray-200);" /><div class="text-right">by ${user.author.name} <em>${normalizeData(user.created_at)}</em></div>`
                    );
                }
                //测试
            });
        } else {
            // 点赞工具提示
            tippy(img, {
                allowHTML: true,
                content: `by ${user.name} 💖`,
                delay: [100, 0]
            });
        }
    });

    // 更新统计信息
}
