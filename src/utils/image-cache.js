import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join(process.cwd(), 'src', 'data', 'image-meta.json');

class ImageCache {
    constructor() {
        this.cache = new Map();
        this.loaded = false;
    }

    load() {
        if (this.loaded) return;
        
        try {
            if (fs.existsSync(CACHE_FILE)) {
                const data = fs.readFileSync(CACHE_FILE, 'utf-8');
                const parsed = JSON.parse(data);
                this.cache = new Map(Object.entries(parsed));
            }
        } catch (error) {
            console.warn('Failed to load image cache:', error);
        }
        
        this.loaded = true;
    }

    save() {
        try {
            const data = Object.fromEntries(this.cache);
            fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
        } catch (error) {
            console.warn('Failed to save image cache:', error);
        }
    }

    get(key) {
        this.load();
        return this.cache.get(key);
    }

    set(key, value) {
        this.load();
        this.cache.set(key, value);
        this.save();
    }

    has(key) {
        this.load();
        return this.cache.has(key);
    }
}

export default new ImageCache();