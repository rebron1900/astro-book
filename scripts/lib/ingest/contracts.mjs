/**
 * 数据集契约：显式声明「产物长什么样」，执行器据此校验后才允许写盘。
 *
 * 规则（见 docs/specs/2026-11-26-data-ingest-spec.md §3）：
 * - 类型只有 string | number | boolean | null | array | object，末尾 '?' 表示可选；
 * - 每条记录必须有稳定 id，且同一次输出内不得重复（去重是来源的责任，执行器只报错）；
 * - version 是契约版本，字段增删或语义变更必须 +1。
 *
 * 新增一个来源 = 在这里加一条契约 + 在 registry.mjs 加一行 + 新建 sources/<id>.mjs。
 * 执行器不认具体源，所以不用改。
 */

/** 支持的字段类型名。 */
export const FIELD_TYPES = ['string', 'number', 'boolean', 'null', 'array', 'object'];

export const contracts = {
    // Emby 观看记录 → src/data/emby.json（时间线「阅读与影视」）
    'emby.viewing': {
        version: 1,
        file: 'emby.json',
        writeMode: 'replace',
        key: 'id',
        allowEmpty: false,
        description: '最近 90 天的 Emby 观看记录（电影 / 剧集），按 lastPlayedAt 降序',
        orderBy: 'lastPlayedAt',
        item: {
            id: 'string',
            type: 'string',
            title: 'string',
            episodeCode: 'string?',
            episodeTitle: 'string?',
            meta: 'string?',
            overview: 'string?',
            minutes: 'number|null',
            rating: 'number|null',
            seriesRating: 'number|null',
            seriesOverview: 'string|null',
            played: 'boolean',
            playedPercent: 'number',
            lastPlayedAt: 'number|null',
            imageTag: 'string?',
            cover: 'string|null'
        }
    },
    // 图片尺寸索引 → src/data/image-meta.json（构建期 RemotePicture 用，避免布局抖动）
    // 结构是「扁平映射」而不是记录数组：键为 size_<url> / error_<url>，值是 { width, height } 或 { timestamp, error }。
    'imagemeta.sizes': {
        version: 1,
        file: 'image-meta.json',
        writeMode: 'replace',
        allowEmpty: false,
        description: 'Ghost 图片尺寸索引（扁平映射，键为 size_<url> / error_<url>）',
        shape: 'map',
        mapKeyPrefixes: ['size_', 'error_'],
        item: {
            type: 'object'
        }
    }
};

/** 取某条契约；未知 dataset 直接抛错（执行器按硬失败处理）。 */
export function getContract(datasetId, all = contracts) {
    const contract = all[datasetId];
    if (!contract) throw new Error(`未知 dataset「${datasetId}」，请在 scripts/lib/ingest/contracts.mjs 登记契约`);
    return contract;
}

/** 契约版本声明：来源模块的 meta.datasetVersions 必须与契约一致。 */
export function assertContractVersion(datasetId, version, all = contracts) {
    const contract = getContract(datasetId, all);
    if (Number(version) !== Number(contract.version)) {
        throw new Error(`契约版本不匹配：${datasetId} 契约 v${contract.version}，来源声明 v${version}（契约变更必须同步两边）`);
    }
    return contract;
}
