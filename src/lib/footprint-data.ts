import { postsAll } from '../api/store';
import geojsonJson from '../data/geojson.json';
import type { FootprintFeature, FootprintPost } from './footprint';
import { buildFootprint } from './footprint';

/**
 * 足迹页用的数据（构建期算好）：标点来自 Google Maps 导出的 geojson，
 * 游记按 Ghost 的 #地点- 标签匹配。运动页的入口和 `/exercise/footprint/` 共用这一份，
 * 别在两个页面里各写一遍取数逻辑。
 */
export function loadFootprintData() {
    return buildFootprint(geojsonJson.features as unknown as FootprintFeature[], postsAll as unknown as FootprintPost[]);
}
