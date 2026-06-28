export interface NavLink {
    text: string;
    href: string;
}

export const headerNavLinks: NavLink[] = [
    { text: 'Home', href: '/' },
    { text: 'Projects', href: '/projects' },
    { text: 'Blog', href: '/blog' },
    { text: 'Tags', href: '/tags' }
];

export const socialLinks = [
    { name: 'github', title: '我的Github', url: 'https://github.com/rebron1900' },
    { name: 'twitter', title: '我的 X', url: 'https://x.com/Passings_z' },
    { name: 'mastodon', title: '我的联邦宇宙', url: 'https://social.1900.live/@1900' },
    { name: 'telegram', title: '我的TG频道', url: 'https://t.me/rebron1900' },
    { name: 'instagram', title: '我的Instagram', url: 'https://www.instagram.com/rebron1900/' },
    { name: 'neodb', title: '我的Neodb', url: 'https://neodb.social/users/1900/' },
    { name: 'strava', title: '我的Strava运动记录', url: 'https://www.strava.com/athletes/100579236' },
    { name: 'unsplash', title: '我的Unsplash', url: 'https://unsplash.com/@rebron1900' }
];

// 注：footer 含内联 HTML，本阶段保留在配置中，Phase 4 移入 Footer 组件渲染
export const footer = [
    { name: 'rss', html: "<a href='https://github.com/rebron1900' target='_blank'>Github</a> / <a href='/rss'  target='_blank'>Rss</a>" },
    { name: 'power', html: "Power by <a href='https://www.astro.build/' target='_blank'>Astro</a> & <a href='https://www.ghost.org/' target='_blank'>ghost</a>" },
    { name: 'theme', html: "Theme: <a href='https://github.com/rebron1900/astro-book' target='_blank'>Astro-book</a>" },
    { name: 'copyright', html: "<a href='https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-hans' target='_blank'>CC BY-NC-ND 4.0</a>" },
    { name: 'icp', html: "<a href='https://beian.miit.gov.cn/' target='_blank'>蜀ICP备16022135号-2</a>" },
    { name: 'upyun', html: "<a href='https://www.upyun.com/?utm_source=lianmeng&utm_medium=referral' target='_blank'>本站由又拍云提供云储存服务</a>" }
];
