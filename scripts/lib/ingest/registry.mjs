/**
 * 来源登记表：**新增来源只在这里加一行**（+ 模块 + 契约）。
 *
 * 只登记模块路径与可选性，不 import 模块本身（避免登记表被加载时产生副作用）。
 * 模块的 meta 仍是权威：registry 的 optional 必须与 meta.optional 一致，不一致按配置错误硬失败。
 */
/** @type {Record<string, { module: string, optional: boolean }>} */
export const sources = {
    emby: { module: '../sources/emby.mjs', optional: true },
    imagemeta: { module: '../sources/imagemeta.mjs', optional: false }
};

export function isIngestSource(name) {
    return Object.prototype.hasOwnProperty.call(sources, name);
}

export function listIngestSources() {
    return Object.keys(sources);
}
