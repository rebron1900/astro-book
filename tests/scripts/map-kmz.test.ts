import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { convertKmzToGeojson, gcj02ToWgs84, wgs84ToGcj02 } from '../../scripts/map/kmz-to-geojson.mjs';
import { buildZip, kmzOf } from '../helpers/kmz';

/**
 * KMZ → GeoJSON 纯函数转换器。
 *
 * 验收基准是 scripts/map/convert_kmz_to_geojson.py 的现行语义（含 shapely 的 mapping 行为），
 * 逐条在下面用构造样本钉住。**注意：本机没有 python3、仓库里也从没有过真实 KMZ，
 * 所以这些用例是「照 Python 源码逐条对齐的构造样本」，不等于与 Python 实际对跑。**
 */

/** 转换器的产物形状（转换器是 .mjs，这里给测试一个收窄后的视图；不用 any）。 */
type Coordinates = number[] | number[][] | number[][][];
type Feature = { type: string; properties: { name?: string | null; description?: string | null }; geometry: { type: string; coordinates: Coordinates } };
type Collection = { type: string; features: Feature[] };

const convert = (bytes: Uint8Array): Collection => convertKmzToGeojson(bytes) as unknown as Collection;
const pointOf = (feature: { geometry: { coordinates: unknown } }): [number, number] => feature.geometry.coordinates as unknown as [number, number];

const KML_HEAD = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;

describe('points / lines / polygons：结构与键顺序', () => {
    it('点/线/面混合：点做 GCJ→WGS、线面坐标原样、description 缺失时不出现该键', () => {
        const kmlText = KML_HEAD(`
            <Placemark><name>点甲</name><description>说明</description>
                <Point><coordinates>116.41024449916938,39.91640428150164,0</coordinates></Point>
            </Placemark>
            <Placemark><name>线乙</name>
                <LineString><coordinates>116.1,39.9,0 116.2,39.8 116.3,39.7</coordinates></LineString>
            </Placemark>
            <Placemark><name>面丙</name>
                <Polygon><outerBoundaryIs><LinearRing>
                    <coordinates>116.0,39.0,0 116.5,39.0 116.5,39.5 116.0,39.5</coordinates>
                </LinearRing></outerBoundaryIs></Polygon>
            </Placemark>`);
        const geojson = convert(kmzOf(kmlText));

        expect(geojson.type).toBe('FeatureCollection');
        expect(geojson.features).toHaveLength(3);
        expect(Object.keys(geojson)).toEqual(['type', 'features']);
        expect(Object.keys(geojson.features[0])).toEqual(['type', 'properties', 'geometry']);

        // 键顺序：name 在前、description 在后
        expect(Object.keys(geojson.features[0].properties)).toEqual(['name', 'description']);
        expect(geojson.features[0].properties.name).toBe('点甲');
        // description 缺失 → 该键不出现（不是 null）
        expect(geojson.features[1].properties).toEqual({ name: '线乙' });

        // 点：GCJ-02 → WGS-84
        const [x, y] = geojson.features[0].geometry.coordinates;
        expect(geojson.features[0].geometry.type).toBe('Point');
        expect(y).toBeCloseTo(39.91500120257608, 12);
        expect(x).toBeCloseTo(116.40400191537934, 12);

        // 线：空白分点、丢高度、不做 GCJ 转换、点数原样
        expect(geojson.features[1].geometry).toEqual({
            type: 'LineString',
            coordinates: [[116.1, 39.9], [116.2, 39.8], [116.3, 39.7]]
        });

        // 面：外环闭合（GEOS 行为：首点≠末点则补首点），坐标一层数组包外环
        expect(geojson.features[2].geometry).toEqual({
            type: 'Polygon',
            coordinates: [[[116.0, 39.0], [116.5, 39.0], [116.5, 39.5], [116.0, 39.5], [116.0, 39.0]]]
        });
    });

    it('CDATA 与转义实体两种 description 得到同样的文本；空 <name></name> → null', () => {
        const cdata = convert(kmzOf(KML_HEAD(
            `<Placemark><description><![CDATA[a<br>b & c]]></description><Point><coordinates>1,2,3</coordinates></Point></Placemark>`
        )));
        const escaped = convert(kmzOf(KML_HEAD(
            `<Placemark><description>a&lt;br&gt;b &amp; c</description><Point><coordinates>1,2,3</coordinates></Point></Placemark>`
        )));
        expect(cdata.features[0].properties.description).toBe('a<br>b & c');
        expect(escaped.features[0].properties.description).toBe('a<br>b & c');

        const empty = convert(kmzOf(KML_HEAD(
            `<Placemark><name></name><Point><coordinates>1,2,3</coordinates></Point></Placemark>`
        )));
        expect(empty.features[0].properties).toEqual({ name: null });

        // 自闭合元素文本也是 null
        const selfClosed = convert(kmzOf(KML_HEAD(
            `<Placemark><name/><Point><coordinates>1,2,3</coordinates></Point></Placemark>`
        )));
        expect(selfClosed.features[0].properties).toEqual({ name: null });
    });

    it('无 Placemark → 空 FeatureCollection（不是错误）；无几何的 Placemark 丢弃；顺序按文档', () => {
        expect(convert(kmzOf(KML_HEAD('')))).toEqual({ type: 'FeatureCollection', features: [] });

        const geojson = convert(kmzOf(KML_HEAD(`
            <Placemark><name>只有名字</name></Placemark>
            <Placemark><name>第三个</name><Point><coordinates>3,3,0</coordinates></Point></Placemark>
            <Placemark><name>第一个</name><Point><coordinates>1,1,0</coordinates></Point></Placemark>
            <Placemark><name>第二个</name><Point><coordinates>2,2,0</coordinates></Point></Placemark>`)));
        expect(geojson.features.map((f: Feature) => f.properties.name)).toEqual(['第三个', '第一个', '第二个']);
    });

    it('同一 Placemark 里 Point 后面还有 Polygon → 最终是 Polygon（后者覆盖前者）', () => {
        const geojson = convert(kmzOf(KML_HEAD(`
            <Placemark><name>混合</name>
                <Point><coordinates>116.0,39.0,0</coordinates></Point>
                <Polygon><outerBoundaryIs><coordinates>1,1,0 2,1,0 2,2,0 1,1,0</coordinates></outerBoundaryIs></Polygon>
            </Placemark>`)));
        expect(geojson.features[0].geometry.type).toBe('Polygon');
        expect(geojson.features[0].geometry.coordinates).toEqual([[[1, 1], [2, 1], [2, 2], [1, 1]]]);
    });

    it('只认 KML 2.2 命名空间：别的前缀/命名空间忽略', () => {
        const foreign = `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:g="http://example.com/other"><Document>
            <g:Placemark><g:name>外部</g:name><g:Point><g:coordinates>1,2,3</g:coordinates></g:Point></g:Placemark>
            <Placemark><name>本地</name><Point><coordinates>1,2,3</coordinates></Point></Placemark>
        </Document></kml>`;
        const geojson = convert(kmzOf(foreign));
        expect(geojson.features).toHaveLength(1);
        expect(geojson.features[0].properties.name).toBe('本地');
    });
});

describe('异常输入：普通 Error + 中文可读', () => {
    it('非 ZIP', () => {
        expect(() => convertKmzToGeojson(Buffer.from('这不是 ZIP'))).toThrow(/不是有效的 ZIP/);
    });

    it('ZIP 里没有 doc.kml', () => {
        expect(() => convertKmzToGeojson(buildZip([{ name: 'other.kml', data: KML_HEAD('') }]))).toThrow(/没有 doc\.kml/);
    });

    it('不支持的压缩方法 99', () => {
        expect(() => convertKmzToGeojson(buildZip([{ name: 'doc.kml', data: KML_HEAD(''), method: 99 }]))).toThrow(/不支持的压缩方法 99/);
    });

    it('Point 坐标只有 2 段', () => {
        expect(() => convert(kmzOf(KML_HEAD(
            `<Placemark><Point><coordinates>116.0,39.0</coordinates></Point></Placemark>`
        )))).toThrow(/必须是「经度,纬度,高度」三段/);
    });

    it('LineString 只有 1 个点', () => {
        expect(() => convert(kmzOf(KML_HEAD(
            `<Placemark><LineString><coordinates>116.0,39.0,0</coordinates></LineString></Placemark>`
        )))).toThrow(/LineString 至少需要 2 个点/);
    });

    it('Polygon 少于 3 个点', () => {
        expect(() => convert(kmzOf(KML_HEAD(
            `<Placemark><Polygon><outerBoundaryIs><coordinates>1,1,0 2,2,0</coordinates></outerBoundaryIs></Polygon></Placemark>`
        )))).toThrow(/Polygon 至少需要 3 个点/);
    });

    it('KML 不是良构 XML / 坐标不是数字', () => {
        expect(() => convert(kmzOf('<kml><Document><Placemark></Document></kml>'))).toThrow(/不是良构的 XML/);
        expect(() => convert(kmzOf(KML_HEAD(
            `<Placemark><Point><coordinates>abc,39.0,0</coordinates></Point></Placemark>`
        )))).toThrow(/坐标不是数字/);
    });
});

describe('坐标转换参考值', () => {
    it('WGS84 (116.404, 39.915) → GCJ-02 (116.41024449916938, 39.91640428150164)，容差 1e-9', () => {
        const [lng, lat] = wgs84ToGcj02(116.404, 39.915);
        expect(lng).toBeCloseTo(116.41024449916938, 9);
        expect(lat).toBeCloseTo(39.91640428150164, 9);
    });

    it('gcj02ToWgs84 是问题里的近似公式：回来的值与原值差在 1e-5 内（Python 同样如此，不改算法）', () => {
        const [lng, lat] = gcj02ToWgs84(116.41024449916938, 39.91640428150164);
        expect(lng).toBeCloseTo(116.404, 5);
        expect(lat).toBeCloseTo(39.915, 5);
        // 近似公式的固有余差（≈2e-6 度），钉住它，避免以后被「改进」成别的算法
        expect(Math.abs(lng - 116.404)).toBeLessThan(5e-6);
        expect(Math.abs(lat - 39.915)).toBeLessThan(5e-6);
    });

    it('境外坐标原样返回（out_of_china 判定）', () => {
        expect(gcj02ToWgs84(139.6917, 35.6895)).toEqual([139.6917, 35.6895]);
        expect(gcj02ToWgs84(-0.1276, 51.5072)).toEqual([-0.1276, 51.5072]);
        // 边界：经度 73.66 / 135.05、纬度 3.86 / 53.55 取不到（Python 用严格不等号）
        expect(gcj02ToWgs84(73.66, 30)).toEqual([73.66, 30]);
        expect(gcj02ToWgs84(135.05, 30)).toEqual([135.05, 30]);
        expect(gcj02ToWgs84(100, 3.86)).toEqual([100, 3.86]);
        expect(gcj02ToWgs84(100, 53.55)).toEqual([100, 53.55]);
    });
});

describe('真实数据回归（反向构造样本，不是真实 KMZ）', () => {
    it('127 条全部往返：由 src/data/geojson.json 反解 GCJ 坐标 → 造 doc.kml → 转换 → 深比较', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'geojson.json'), 'utf8'));
        expect(real.features.length).toBeGreaterThan(100);

        let maxError = 0;
        const placemarks = real.features.map((feature: { properties: { name: string; description?: string }; geometry: { coordinates: [number, number] } }) => {
            const [wx, wy] = pointOf(feature);
            // 反解：找 g 使 gcj02ToWgs84(g) == 存储的 WGS 坐标（迭代 ≤20 次，收敛到 1e-12）
            let [gx, gy] = wgs84ToGcj02(wx, wy);
            for (let i = 0; i < 20; i += 1) {
                const [cx, cy] = gcj02ToWgs84(gx, gy);
                const ex = wx - cx;
                const ey = wy - cy;
                gx += ex;
                gy += ey;
                if (Math.abs(ex) < 1e-12 && Math.abs(ey) < 1e-12) break;
            }
            const [bx, by] = gcj02ToWgs84(gx, gy);
            maxError = Math.max(maxError, Math.abs(bx - wx), Math.abs(by - wy));

            const description = feature.properties.description === undefined
                ? ''
                : `<description><![CDATA[${feature.properties.description}]]></description>`;
            return `<Placemark><name>${feature.properties.name}</name>${description}<Point><coordinates>${gx},${gy},0</coordinates></Point></Placemark>`;
        });

        const kmlText = KML_HEAD(placemarks.join('\n'));
        const converted = convert(kmzOf(kmlText, 0));

        expect(converted.features).toHaveLength(real.features.length);
        for (const [index, feature] of converted.features.entries()) {
            const source = real.features[index];
            expect(feature.type).toBe('Feature');
            expect(feature.properties.name).toBe(source.properties.name);
            expect(feature.properties.description).toBe(source.properties.description);
            expect(feature.geometry.type).toBe('Point');
            const [bx, by] = pointOf(feature);
            const [sx, sy] = pointOf(source);
            expect(Math.abs(bx - sx)).toBeLessThan(1e-9);
            expect(Math.abs(by - sy)).toBeLessThan(1e-9);
        }
        // 反解本身的最大偏差（远小于断言的 1e-9）
        expect(maxError).toBeLessThan(1e-9);
    });
});
