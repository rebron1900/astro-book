import { describe, expect, it } from 'vitest';
import { buildTabBar, stripNavEmoji, TAB_PRIMARY } from '../../src/lib/tabbar';

const nav = [
    { url: '/', label: '首页 🏠' },
    { url: '/links/', label: '左邻右舍 🧑‍🤝‍🧑' },
    { url: '/timeline/memo/', label: 'Now 🚩' },
    { url: '/douban/', label: '书影音游 📖' },
    { url: '/about/', label: '关于 😎' },
    { url: '/activity/', label: '运动&足迹 🧗‍♂️' },
    { url: '/garden/', label: '好奇心花园🪴' },
    { url: '/archives/', label: '归档 📦' },
    { url: '/tags/', label: 'Tags 📌' }
];

describe('底部导航装配', () => {
    it('常驻项按 TAB_PRIMARY 的顺序，不受菜单顺序影响', () => {
        const { tabs } = buildTabBar(nav, '/');
        expect(tabs.map((item) => item.url)).toEqual(['/', '/timeline/memo/', '/activity/', '/douban/']);
    });

    it('其余入口全部落进「更多」，一个都不丢', () => {
        const { tabs, more } = buildTabBar(nav, '/');
        expect(tabs.length + more.length).toBe(nav.length);
        expect(more.map((item) => item.url)).toEqual(['/links/', '/about/', '/garden/', '/archives/', '/tags/']);
    });

    it('去掉 emoji，底栏用短标签，更多里用完整名称', () => {
        const { tabs, more } = buildTabBar(nav, '/');
        expect(tabs.map((item) => item.short)).toEqual(['首页', 'Now', '运动', '书影音']);
        expect(tabs.every((item) => !/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(item.label))).toBe(true);
        expect(more.find((item) => item.url === '/garden/')?.label).toBe('好奇心花园');
    });

    it('高亮当前页：父级路径与时间线各频道都算', () => {
        expect(buildTabBar(nav, '/timeline/memo/2/').tabs[1].active).toBe(true);
        expect(buildTabBar(nav, '/timeline/reading/').tabs[1].active).toBe(true);
        expect(buildTabBar(nav, '/activity/').tabs[2].active).toBe(true);
        expect(buildTabBar(nav, '/garden/22-knowledge/').more.find((i) => i.url === '/garden/')?.active).toBe(true);
    });

    it('首页不会因为前缀匹配吞掉所有页面', () => {
        const { tabs } = buildTabBar(nav, '/archives/');
        expect(tabs[0].active).toBe(false);
        expect(tabs.some((item) => item.active)).toBe(false);
    });

    it('导航里缺项时跳过，不占位；重复地址只认第一条', () => {
        const { tabs, more } = buildTabBar(
            [
                { url: '/', label: '首页' },
                { url: '/', label: '首页重复' },
                { url: '/tags/', label: 'Tags' }
            ],
            '/tags/'
        );
        expect(tabs.map((item) => item.url)).toEqual(['/']);
        expect(more.map((item) => item.url)).toEqual(['/tags/']);
    });

    it('空配置与非法条目不会炸', () => {
        expect(buildTabBar(undefined, '/').tabs).toEqual([]);
        expect(buildTabBar([], '/').more).toEqual([]);
        const { more } = buildTabBar([{ url: '/x/', label: '' }, { url: '', label: '空地址' }] as never, '/x/');
        expect(more[0]).toEqual({ url: '/x/', label: '', short: '', active: true });
    });

    it('TAB_PRIMARY 里没有重复项', () => {
        expect(new Set(TAB_PRIMARY).size).toBe(TAB_PRIMARY.length);
    });
});

describe('菜单名去 emoji', () => {
    it('普通 emoji 与 ZWJ 组合都能去掉', () => {
        expect(stripNavEmoji('首页 🏠')).toBe('首页');
        expect(stripNavEmoji('运动&足迹 🧗‍♂️')).toBe('运动&足迹');
        expect(stripNavEmoji('左邻右舍 🧑‍🤝‍🧑')).toBe('左邻右舍');
    });

    it('没有 emoji 的名称原样保留', () => {
        expect(stripNavEmoji('Tags 📌')).toBe('Tags');
        expect(stripNavEmoji('归档')).toBe('归档');
    });
});
