const config = {
    blogURL: 'https://1900.live',
    memos: {
        url: 'https://memos.1900.live/api/v1/memo?creatorId=101&limit=all',
        limit: 10,
        offset: 10
    },
    apiUrl: 'https://api.1900.live',
    customPage: ['archives', 'memos', 'links', 'douban', 'albums', 'map'],

    //配置合集信息
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
    ],
    footer: [
        {
            name: 'rss',
            html: "<a href='https://github.com/rebron1900' target='_blank'>Github</a> | <a href='https://1900.live/rss/'  target='_blank'>Rss</a>"
        },
        {
            name: 'power',
            html: "Power by <a href='https://www.astro.build/' target='_blank'>Astro</a> & <a href='https://www.ghost.org/' target='_blank'>ghost</a>"
        },
        {
            name: 'theme',
            html: "Theme: <a href='https://github.com/rebron1900/astro-book' target='_blank'>Astro-book</a>"
        },
        {
            name: 'copyright',
            html: "<a href='https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-hans' target='_blank'>CC BY-NC-ND 4.0</a>"
        },
        {
            name: 'icp',
            html: "<a href='https://beian.miit.gov.cn/' target='_blank'>蜀ICP备16022135号-2</a>"
        },
        {
            name: 'upyun',
            html: "<a href='https://www.upyun.com/?utm_source=lianmeng&utm_medium=referral' target='_blank'>本站由又拍云提供云储存服务</a>"
        }
    ],
    themes: [
        {
            name: 'light',
            desc: '月牙白',
            type: 'light'
        },
        {
            name: 'dark',
            desc: '极夜黑',
            type: 'dark'
        },
        {
            name: 'yayu',
            desc: '雅余黄',
            type: 'dark'
        },
        {
            name: 'yuhang',
            desc: '昱行粉',
            type: 'dark'
        },
        {
            name: 'herblue',
            desc: '她的蓝',
            type: 'dark'
        },
        {
            name: 'onojyun',
            desc: '莫比乌斯',
            type: 'light'
        },
        {
            name: 'auto',
            desc: '自适应',
            type: 'auto'
        }
    ],
    app: {
        wechat: {
            title: '微信',
            url: 'wechat.png',
            action: '摸鱼'
        },
        chrome: {
            title: 'Chrome',
            url: 'chrome.png',
            action: '冲浪'
        },
        code: {
            title: 'Visual Studio Code',
            url: 'code.png',
            action: '捣鼓一些小玩意儿'
        },
        'lx-music-desktop.exe': {
            title: '洛雪音乐播放器',
            url: 'music.png',
            action: '听音乐'
        },
        tim: {
            title: 'TIM',
            url: 'qq.png',
            action: '摸鱼'
        },
        hydee: {
            title: '工作ERP',
            url: 'hydee.jpg',
            action: '工作'
        },
        wxwork: {
            title: '企业微信',
            url: 'wxwork.png',
            action: '工作'
        },
        obsidian: {
            title: 'Obsidian',
            url: 'obsidian.png',
            action: '做笔记'
        },
        windowsterminal: {
            title: 'WindowsTerminal',
            url: 'windowsterminal.png',
            action: ''
        },
        tabby: {
            title: 'Tabby',
            url: 'tabby.png',
            action: '维护服务器'
        },
        et: {
            title: 'Excel',
            url: 'excel.png',
            action: '统计数据中'
        },
        wps: {
            title: 'Word',
            url: 'word.png',
            action: '编写文档中'
        }
    },
    social: [
        { name: 'github', url: 'https://github.com/rebron1900' },
        { name: 'twitter', url: 'https://x.com/Passings_z' },
        { name: 'mastodon', url: 'https://phanpy.social/#/mast.dragon-fly.club/a/109686014103594251' },
        { name: 'telegram', url: 'https://t.me/rebron1900' },
        { name: 'instagram', url: 'https://www.instagram.com/rebron1900/' },
        { name: 'neodb', url: 'https://neodb.social/users/1900/' }
    ]
};
export default config;
