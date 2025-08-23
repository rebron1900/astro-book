/**
 * OG (Open Graph) 信息缓存模块
 * 用于缓存从外部网站获取的OG信息，减少重复请求
 */

import fs from 'fs';
import path from 'path';

// 缓存文件路径
const CACHE_DIR = path.join(process.cwd(), 'src', 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'og-cache.json');

// 缓存有效期（毫秒） - 7天
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

// 确保缓存目录存在
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

// 读取缓存
function readCache() {
    try {
        ensureCacheDir();
        if (!fs.existsSync(CACHE_FILE)) {
            return {};
        }
        const data = fs.readFileSync(CACHE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('读取OG缓存失败:', error);
        return {};
    }
}

// 写入缓存
function writeCache(cache) {
    try {
        ensureCacheDir();
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch (error) {
        console.error('写入OG缓存失败:', error);
    }
}

// 获取缓存的OG信息
export function getCachedOG(url) {
    const cache = readCache();
    const cached = cache[url];
    
    if (!cached) {
        return null;
    }
    
    // 检查缓存是否过期
    const now = Date.now();
    if (now - cached.timestamp > CACHE_TTL) {
        // 缓存过期，删除该条目
        delete cache[url];
        writeCache(cache);
        return null;
    }
    
    return cached.data;
}

// 设置OG信息到缓存
export function setCachedOG(url, data) {
    const cache = readCache();
    cache[url] = {
        data,
        timestamp: Date.now()
    };
    writeCache(cache);
}

// 清理过期缓存
export function cleanupCache() {
    const cache = readCache();
    const now = Date.now();
    let hasChanges = false;
    
    for (const [url, entry] of Object.entries(cache)) {
        if (now - entry.timestamp > CACHE_TTL) {
            delete cache[url];
            hasChanges = true;
        }
    }
    
    if (hasChanges) {
        writeCache(cache);
    }
}

// 获取缓存统计信息
export function getCacheStats() {
    const cache = readCache();
    const now = Date.now();
    
    let total = 0;
    let valid = 0;
    let expired = 0;
    
    for (const [url, entry] of Object.entries(cache)) {
        total++;
        if (now - entry.timestamp <= CACHE_TTL) {
            valid++;
        } else {
            expired++;
        }
    }
    
    return {
        total,
        valid,
        expired,
        ttl: CACHE_TTL
    };
}

// 定期清理过期缓存（每天一次）
setInterval(cleanupCache, 24 * 60 * 60 * 1000);

// 初始化时清理一次
cleanupCache();