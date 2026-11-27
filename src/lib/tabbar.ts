/**
 * 移动端底部导航的数据装配。
 *
 * 站上一共有 9 个一级入口，窄屏一行放不下，所以拆成两级：
 * 底栏常驻 4 个（TAB_PRIMARY 决定顺序），其余入口全部收进「更多」浮层。
 * 以后增减导航只需要改 Ghost 后台的菜单；要换常驻项改 TAB_PRIMARY 这一个数组。
 */
import { isActiveUrl, normalizePath } from './utils/active-url';

export interface NavLink {
    url: string;
    label: string;
}

export interface TabItem {
    url: string;
    /** 去掉 emoji 的名称，浮层里用 */
    label: string;
    /** 底栏上的短标签，比菜单短一档 */
    short: string;
    active: boolean;
}

/** 底栏常驻入口，按这个顺序显示；导航配置里没有的会被跳过。 */
export const TAB_PRIMARY: string[] = ['/', '/timeline/memo/', '/activity/', '/douban/'];

const keyOf = (url: string): string => normalizePath(url);

/** 键统一按 normalizePath 处理，写配置时带不带尾斜杠都能命中。 */
const byPath = <T>(map: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(map).map(([url, value]) => [keyOf(url), value]));

/** 底栏短标签。没配的入口退回菜单名。 */
const SHORT_LABELS = byPath({
    '/': '首页',
    '/timeline/memo/': 'Now',
    '/activity/': '运动',
    '/douban/': '书影音'
});

/** 一个入口代表的整片区域：时间线各个频道都算 Now。 */
const ALIASES = byPath({
    '/timeline/memo/': ['/timeline/']
});

// 末尾 emoji 序列：支持 ZWJ 组合与肤色修饰符（与左栏菜单同一套规则）
const EMOJI_SEQ = /(\p{RI}\p{RI}|\p{Emoji}[\uFE0F\uFE0E]?(\p{Emoji_Modifier}|\u200D\p{Emoji}[\uFE0F\uFE0E]?)*)$/u;

/** 去掉菜单名末尾的 emoji，留下纯文字。 */
export const stripNavEmoji = (label: string): string => label.replace(EMOJI_SEQ, '').trim();

const isTabActive = (pathname: string, url: string): boolean =>
    isActiveUrl(pathname, url) || (ALIASES[keyOf(url)] ?? []).some((alias) => isActiveUrl(pathname, alias));

export function buildTabBar(nav: NavLink[] | undefined, pathname: string): { tabs: TabItem[]; more: TabItem[] } {
    const items: TabItem[] = (nav ?? [])
        .filter((item) => item && typeof item.url === 'string' && typeof item.label === 'string')
        .map((item) => {
            const label = stripNavEmoji(item.label) || item.label;
            return { url: item.url, label, short: SHORT_LABELS[keyOf(item.url)] ?? label, active: false };
        });

    // 同一地址只认第一条，避免配置里重复时底栏出现两格一样的东西
    const byKey = new Map<string, TabItem>();
    for (const item of items) {
        const key = keyOf(item.url);
        if (!byKey.has(key)) byKey.set(key, item);
    }

    const tabs = TAB_PRIMARY.map((url) => byKey.get(keyOf(url)))
        .filter((item): item is TabItem => Boolean(item))
        .map((item) => ({ ...item, active: isTabActive(pathname, item.url) }));

    const primaryKeys = new Set(tabs.map((item) => keyOf(item.url)));
    const more = items
        .filter((item) => !primaryKeys.has(keyOf(item.url)))
        .map((item) => ({ ...item, active: isActiveUrl(pathname, item.url) }));

    return { tabs, more };
}
