/**
 * 数据集契约：显式声明「产物长什么样」，执行器据此校验后才允许写盘。
 *
 * 规则（见 docs/specs/2026-11-26-data-ingest-spec.md §3）：
 * - 类型只有 string | number | boolean | null | array | object，末尾 '?' 表示可选；
 * - 每条记录必须有稳定 id，且同一次输出内不得重复（去重是来源的责任，执行器只报错）；
 * - version 是契约版本，字段增删或语义变更必须 +1。
 *
 * 三种产物形状（`shape`）：
 * - 省略 / 'list'：顶层是记录数组，`item` 描述每条记录，`key` 默认 'id'；
 * - 'map'：顶层是扁平映射（键带前缀），`item` 只做值类型声明；
 * - 'object'：顶层是对象，用 `fields` 逐字段声明（字段可以是类型串，也可以是数组描述），
 *   `countField` 指定日志/状态里用哪一段数组的长度作为条数；未声明的字段放行。
 *
 * 数组字段描述：`{ type: 'array', item?, key?, allowEmpty?, orderBy?, orderDir? }`
 * - `key` 省略 = 不做主键唯一性校验（如 reading.books、geojson.features 没有稳定 id）；
 * - `orderDir` 默认 'desc'，'asc' 用于 activities 这类升序产物。
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
    },
    // 动态（Memos / GoToSocial）→ src/data/memos.json（now 页）
    // 落地前已按 src/lib/privacy.ts 过滤非公开，本契约不再重复判可见性。
    'memos.list': {
        version: 1,
        file: 'memos.json',
        writeMode: 'replace',
        key: 'id',
        allowEmpty: false,
        description: '动态列表，按 createdTs 降序；仅含发布白名单内的可见性',
        orderBy: 'createdTs',
        orderDir: 'desc',
        item: {
            id: 'string',
            content: 'string',
            createdTs: 'number',
            updatedTs: 'number',
            creatorName: 'string',
            resourceList: 'array',
            visibility: 'string',
            pinned: 'boolean',
            type: 'string'
        }
    },
    // Ghost 内容 → src/data/ghost.json（全站内容源：文章 / 页面 / 作者 / 标签）
    // 形状是对象而不是单一数组，所以用 shape:'object' + fields：五段分别声明，未声明字段放行。
    'ghost.content': {
        version: 1,
        file: 'ghost.json',
        writeMode: 'replace',
        allowEmpty: false,
        description: 'Ghost 内容快照：settings + posts/pages/authors/tags（tags 内嵌裁剪后的 posts）',
        shape: 'object',
        countField: 'posts',
        fields: {
            settings: 'object|null',
            posts: {
                type: 'array',
                allowEmpty: false,
                key: 'id',
                item: {
                    id: 'string',
                    slug: 'string',
                    title: 'string',
                    html: 'string?',
                    excerpt: 'string?',
                    feature_image: 'string|null',
                    feature_image_alt: 'string|null|object',
                    feature_image_caption: 'string|null',
                    published_at: 'string|null',
                    updated_at: 'string|null',
                    created_at: 'string|null',
                    reading_time: 'number?',
                    tags: 'array',
                    authors: 'array',
                    type: 'string'
                }
            },
            pages: {
                type: 'array',
                key: 'id',
                item: {
                    id: 'string',
                    slug: 'string',
                    title: 'string',
                    html: 'string?',
                    excerpt: 'string?',
                    feature_image: 'string|null',
                    feature_image_alt: 'string|null|object',
                    feature_image_caption: 'string|null',
                    published_at: 'string|null',
                    updated_at: 'string|null',
                    created_at: 'string|null',
                    reading_time: 'number?',
                    tags: 'array',
                    authors: 'array',
                    type: 'string'
                }
            },
            authors: {
                type: 'array',
                key: 'id',
                item: {
                    id: 'string',
                    slug: 'string|null',
                    name: 'string|null',
                    profile_image: 'string|null',
                    cover_image: 'string|null',
                    bio: 'string|null'
                }
            },
            tags: {
                type: 'array',
                key: 'id',
                item: {
                    id: 'string',
                    slug: 'string?',
                    name: 'string?',
                    visibility: 'string?',
                    count: 'object?',
                    posts: {
                        type: 'array',
                        key: 'id',
                        item: {
                            id: 'string',
                            slug: 'string?',
                            title: 'string?',
                            excerpt: 'string?',
                            feature_image: 'string|null',
                            feature_image_alt: 'string|null|object',
                            feature_image_caption: 'string|null',
                            published_at: 'string|null',
                            updated_at: 'string|null',
                            created_at: 'string|null',
                            reading_time: 'number?',
                            tags: 'array',
                            type: 'string'
                        }
                    }
                }
            }
        }
    },
    // 远端排名/状态 → src/data/rank.json：无主键，未声明字段一律放行。
    // 只声明页面真正消费的 myRank（Now.astro 读 myRank.totalDuration）；上游成功载荷目前是
    // {success, myRank}，myRank 可选，空对象也能过。
    // 上游失败时返回 {success:false,error:'…'}：页面读不到 myRank 会静默显示 0 小时，
    // 所以把 error 声明成「只能缺席或为 null」——带错误信息的载荷判为不合格，不覆盖旧文件。
    'rank.status': {
        version: 1,
        file: 'rank.json',
        writeMode: 'replace',
        allowEmpty: false,
        description: '远端排名/状态 JSON（声明页面消费的 myRank 与错误载荷的 error，其余字段放行）',
        shape: 'object',
        fields: { myRank: 'object?', error: 'null?' }
    },
    // modureader 阅读汇总 → src/data/reading.json（阅读页 / 阅读卡片）；books/days 都没有稳定 id
    'reading.digest': {
        version: 1,
        file: 'reading.json',
        writeMode: 'replace',
        allowEmpty: false,
        description: '每日阅读汇总（总计 / 书目 / 按天明细 / 清洗告警），可选源',
        shape: 'object',
        countField: 'days',
        fields: {
            generatedAt: 'string',
            source: 'string',
            totals: 'object',
            books: {
                type: 'array',
                item: {
                    title: 'string',
                    seconds: 'number',
                    days: 'number',
                    author: 'string?',
                    cover: 'string?',
                    description: 'string?',
                    progress: 'number|null?'
                }
            },
            days: {
                type: 'array',
                item: {
                    date: 'string',
                    seconds: 'number',
                    books: {
                        type: 'array',
                        item: {
                            title: 'string',
                            seconds: 'number',
                            highlights: 'array',
                            author: 'string?',
                            cover: 'string?',
                            description: 'string?',
                            progress: 'number|null?',
                            progressEst: 'number?'
                        }
                    }
                }
            },
            warnings: 'array'
        }
    },
    // 足迹 GeoJSON → src/data/geojson.json：FeatureCollection，features 没有稳定 id（key 省略）
    'map.geojson': {
        version: 1,
        file: 'geojson.json',
        writeMode: 'replace',
        allowEmpty: false,
        description: 'KMZ 转换出的足迹标点（FeatureCollection，features 无稳定 id）',
        shape: 'object',
        countField: 'features',
        fields: {
            type: 'string',
            features: {
                type: 'array',
                allowEmpty: false,
                item: {
                    type: 'string',
                    properties: 'object?',
                    geometry: 'object'
                }
            }
        }
    },
    // intervals.icu 运动记录 → src/data/activities.json：升序（页面时间线按 start_date_local 从早到晚）
    'intervals.activities': {
        version: 1,
        file: 'activities.json',
        writeMode: 'replace',
        key: 'id',
        allowEmpty: false,
        description: 'intervals.icu 全量活动，按 start_date_local 升序；polyline 为可选轨迹',
        orderBy: 'start_date_local',
        orderDir: 'asc',
        item: {
            id: 'string',
            name: 'string',
            distance: 'number',
            moving_time: 'number',
            type: 'string',
            start_date: 'string',
            start_date_local: 'string',
            average_heartrate: 'number|null',
            average_speed: 'number|null',
            elevation_gain: 'number',
            polyline: 'string?',
            url: 'string?',
            source: 'string?'
        }
    },
    // RSS 订阅最新文章 → src/data/flux.json（友链页），按 update_timestamp 降序（由 flux-snapshot 保证）
    'flux.feed': {
        version: 1,
        file: 'flux.json',
        writeMode: 'replace',
        key: 'url',
        allowEmpty: false,
        description: '各订阅的最新一篇文章 + 所属订阅信息',
        item: {
            title: 'string?',
            url: 'string',
            published_at: 'string?',
            created_at: 'string?',
            feed: 'object',
            feed_id: 'number|string',
            update_timestamp: 'number'
        }
    },
    // 失联订阅 → src/data/flux-lost.json：空是合法结果（全部恢复时文件就是 []）
    'flux.lost': {
        version: 1,
        file: 'flux-lost.json',
        writeMode: 'replace',
        key: 'id',
        allowEmpty: true,
        description: '没有最新文章 / 抓取异常 / 被停用的订阅（按标题排序）',
        item: {
            id: 'number|string',
            title: 'string',
            site_url: 'string',
            reason: 'string',
            first_seen_at: 'string',
            feed_url: 'string?',
            error: 'string?',
            last_entry_at: 'string?'
        }
    },
    // NeoDB 标记 → src/data/neodb.json（douban 页），按 created_time 降序
    'neodb.marks': {
        version: 1,
        file: 'neodb.json',
        writeMode: 'replace',
        allowEmpty: false,
        description: 'NeoDB 书影音标记（增量合并后的全集），按 created_time 降序',
        shape: 'object',
        countField: 'data',
        fields: {
            data: {
                type: 'array',
                allowEmpty: false,
                key: 'post_id',
                orderBy: 'created_time',
                orderDir: 'desc',
                item: {
                    post_id: 'number|string',
                    shelf: 'string?',
                    type: 'string?',
                    title: 'string?',
                    comment_text: 'string|null',
                    rating_grade: 'number|null',
                    item: 'object|null',
                    created_time: 'string',
                    visibility: 'number|null'
                }
            }
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
