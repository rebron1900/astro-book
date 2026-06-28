export { siteConfig } from './site';
export { themes } from './theme';
export type { ThemeConfig } from './theme';
export { apps } from './apps';
export type { AppConfig } from './apps';
export { headerNavLinks, socialLinks, footer } from './nav';
export type { NavLink } from './nav';

// 向后兼容：聚合默认导出，保持 `import config from '../config'` + `config.xxx` 用法不变
import { siteConfig } from './site';
import { themes } from './theme';
import { apps } from './apps';
import { headerNavLinks, socialLinks, footer } from './nav';

const config = {
    blogURL: siteConfig.blogURL,
    apiUrl: siteConfig.apiUrl,
    memos: siteConfig.memos,
    customPage: siteConfig.customPage,
    taxonomy: siteConfig.taxonomy,
    themes,
    app: apps,
    social: socialLinks,
    headerNavLinks,
    footer
};

export default config;
