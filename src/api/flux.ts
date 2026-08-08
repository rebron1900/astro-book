import type { FluxEntry, FluxFeed } from './types';

const fluxURL = import.meta.env.FLUX_URL;
const fluxKey = import.meta.env.FLUX_KEY;

export async function getFlux(): Promise<FluxEntry[]> {
    try {
        // 第一步：获取所有feeds
        const feedsResponse = await fetch(`${fluxURL}/categories/4/feeds`, {
            method: 'GET',
            headers: {
                'X-Auth-Token': fluxKey
            }
        });

        if (!feedsResponse.ok) {
            throw new Error(`HTTP error! status: ${feedsResponse.status}`);
        }

        const feedsData = await feedsResponse.json();
        const feeds: FluxFeed[] = feedsData.feeds || feedsData;

        // 第二步：获取每个feed的最新文章
        const feedPromises = feeds.map(async (feed): Promise<FluxEntry | null> => {
            try {
                // 使用limit=1和order参数直接获取最新一条数据
                const entriesResponse = await fetch(`${fluxURL}/feeds/${feed.id}/entries?limit=1&order=published_at&direction=desc`, {
                    method: 'GET',
                    headers: {
                        'X-Auth-Token': fluxKey
                    }
                });

                if (!entriesResponse.ok) {
                    console.warn(`无法获取feed ${feed.id} 的entries: ${entriesResponse.status}`);
                    return null;
                }

                const entriesData = await entriesResponse.json();
                const entries = entriesData.entries || entriesData;

                // 获取最新文章
                if (entries.length > 0) {
                    const latestEntry = entries[0];
                    const domain = new URL(feed.site_url).origin;
                    const updateTime = new Date(latestEntry.published_at || latestEntry.created_at || latestEntry.date).getTime();

                    return {
                        ...latestEntry,
                        feed_id: feed.id,
                        feed: {
                            ...feed,
                            site_url: domain
                        },
                        // 添加更新时间戳用于排序
                        update_timestamp: updateTime
                    };
                }

                // 如果没有文章，返回null
                return null;
            } catch (error) {
                console.error(`获取feed ${feed.id} 数据时出错:`, error);
                return null;
            }
        });

        // 等待所有feed的请求完成
        const results = await Promise.all(feedPromises);

        // 过滤掉null值（只返回有文章的feed）
        const validEntries = results.filter((entry): entry is FluxEntry => entry !== null);

        // 按更新时间排序（最新的在前）
        validEntries.sort((a, b) => {
            const timeA = a.update_timestamp || 0;
            const timeB = b.update_timestamp || 0;
            return timeB - timeA; // 降序排列
        });

        return validEntries;
    } catch (error) {
        console.error('请求错误:', error);
        return []; // Return an empty array or handle the error as needed
    }
}
