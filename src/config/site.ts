export const siteConfig = {
    blogURL: 'https://1900.live',
    apiUrl: 'https://hapi.190102.xyz:4433/blog',
    strava: {
        // 跑步活动数据源（raw GitHub JSON）
        activitiesUrl: 'https://raw.githubusercontent.com/rebron1900/running_page/2aa7902357e6212c61e13a3e7d143d50487d8fc8/src/static/activities.json'
    },
    memos: {
        url: 'https://m2m.996288.xyz/api/v1/memo',
        siteURL: 'https://m2m.996288.xyz',
        limit: 10,
        offset: 10
    },
    customPage: ['archives', 'memos', 'links', 'douban', 'albums', 'map', 'strava', 'tags'],
    taxonomy: [
        {
            name: '节气',
            slug: 'jie-qi',
            desc: '24节气是中国劳动人民的智慧和浪漫...',
            tags: ['jie-qi']
        },
        {
            name: '工具箱',
            slug: 'tools',
            desc: '收集的小玩意儿和工具有关的经验分享...',
            tags: ['gong-ju-xiang', 'xiao-he-shuang-pin', 'chromium', 'docker', 'jamstack', 'memos', 'nginx', 'rime', 'spa']
        }
    ]
};
