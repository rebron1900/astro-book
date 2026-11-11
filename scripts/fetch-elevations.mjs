#!/usr/bin/env node
/**
 * 给足迹标点补一份海拔数据（`src/data/place-elevations.json`）。
 *
 * 用 open-meteo 的 elevation 接口（免 key，批量最多 100 个坐标/次）。
 * 之所以在「同步阶段」把结果落盘，是因为构建期必须零网络依赖（见 AGENTS.md 数据层规则）。
 *
 * 用法：node scripts/fetch-elevations.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const GEOJSON = resolve(root, 'src/data/geojson.json');
const OUTPUT = resolve(root, 'src/data/place-elevations.json');
const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
const BATCH = 90;
const dryRun = process.argv.includes('--dry-run');

const geojson = JSON.parse(readFileSync(GEOJSON, 'utf8'));
/** name -> { lat, lng }，同名标点只取一次 */
const targets = new Map();
for (const feature of geojson.features ?? []) {
    const name = feature?.properties?.name;
    const coords = feature?.geometry?.coordinates;
    if (!name || !Array.isArray(coords) || coords.length < 2) continue;
    if (targets.has(name)) continue;
    targets.set(name, { lng: coords[0], lat: coords[1] });
}

const list = [...targets.entries()];
console.log(`待取海拔的标点：${list.length} 个`);

const places = {};
for (let index = 0; index < list.length; index += BATCH) {
    const batch = list.slice(index, index + BATCH);
    const params = new URLSearchParams();
    for (const [, { lat, lng }] of batch) {
        params.append('latitude', lat.toFixed(5));
        params.append('longitude', lng.toFixed(5));
    }
    const url = `${ENDPOINT}?${params.toString()}`;
    if (dryRun) {
        console.log('[dry-run]', url.slice(0, 120) + '…');
        continue;
    }
    const response = await fetch(url);
    if (!response.ok) {
        console.error(`请求失败 ${response.status}：第 ${index / BATCH + 1} 批`);
        process.exitCode = 1;
        continue;
    }
    const data = await response.json();
    const values = data?.elevation ?? [];
    batch.forEach(([name], offset) => {
        const value = values[offset];
        if (typeof value === 'number' && Number.isFinite(value)) places[name] = Math.round(value);
    });
    console.log(`第 ${index / BATCH + 1} 批完成（累计 ${Object.keys(places).length}）`);
}

if (dryRun) process.exit(0);

const payload = {
    generatedAt: new Date().toISOString(),
    source: 'open-meteo elevation api',
    unit: 'm',
    places
};
writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`已写入 ${OUTPUT}（${Object.keys(places).length} 条）`);
