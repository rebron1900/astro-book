import fs from 'fs/promises';
import path from 'path';

const CACHE_FILE = path.join(process.cwd(), 'src', 'data', 'image-meta.json');

class ImageCache {
    constructor() {
        this.cache = new Map();
        this.loaded = false; // 节流或防抖变量
        this.saveTimeout = null;
    }

    async load() {
        if (this.loaded) return;
        try {
            const data = await fs.readFile(CACHE_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            this.cache = new Map(Object.entries(parsed));
        } catch (error) {
            // 文件不存在是正常情况，可以忽略
            if (error.code !== 'ENOENT') {
                console.warn('Failed to load image cache:', error);
            }
        }
        this.loaded = true;
    } // 使用防抖保存

    async save() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(async () => {
            try {
                const data = Object.fromEntries(this.cache);
                await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
            } catch (error) {
                console.warn('Failed to save image cache:', error);
            }
        }, 1000); // 1秒内没有新的写入操作才保存
    }

    async get(key) {
        await this.load();
        return this.cache.get(key);
    }

    async set(key, value) {
        await this.load();
        this.cache.set(key, value);
        this.save(); // 触发防抖保存
    }

    async has(key) {
        await this.load();
        return this.cache.has(key);
    }
}

export default new ImageCache();
