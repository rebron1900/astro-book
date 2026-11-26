/**
 * KMZ → GeoJSON（纯函数，零依赖：node:zlib 解压 + 自带的最小 XML 解析器）。
 *
 * 逐条对齐原 Python 实现（scripts/map/convert_kmz_to_geojson.py + coordTransform_utils.gcj02_to_wgs84，
 * 已在本轮随 JS 版一起删除，可在 git 历史里查看）的语义，
 * 不「改进」：
 *  - 只认 ZIP 里精确名为 doc.kml 的条目（store / deflate 两种压缩，其它方法报错）；
 *  - 只认 http://www.opengis.net/kml/2.2 命名空间下的元素，其它前缀/命名空间忽略；
 *  - 按文档顺序遍历 Placemark；properties.name 在前、description 在后，同名字段后者覆盖前者，
 *    元素存在但无文本 → null，元素不存在 → 该键不出现；
 *  - 几何按 Point → LineString → Polygon 三段循环依次赋值到同一个 feature.geometry，最后命中的生效；
 *  - Point 坐标必须正好 3 段（lon,lat,高度），取前两段并做 GCJ-02 → WGS-84；
 *  - LineString / Polygon 坐标按空白分点、每点取前两段，**不做** GCJ 转换（与现行 Python 一致，
 *    这是已知的不一致：点转换、线面不转换，按验收要求原样保留）；
 *  - Polygon 只取 outerBoundaryIs 下的 coordinates，并按 shapely/GEOS 的行为闭合外环；
 *  - 无几何的 Placemark 丢弃；一个都没有时返回空 FeatureCollection（不是错误）。
 *
 * 任何异常输入都抛普通 Error（中文可读），不读不写文件、不返回半个对象。
 */
import { inflateRawSync } from 'node:zlib';

const KML_NS = 'http://www.opengis.net/kml/2.2';
const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// ---------------------------------------------------------------------------
// GCJ-02 → WGS-84（公式取自原 coordTransform_utils.py，常数逐字相同）
// ---------------------------------------------------------------------------
const PI = 3.1415926535897932384626;
const A = 6378245.0; // 长半轴
const EE = 0.00669342162296594323; // 偏心率平方

function outOfChina(lon, lat) {
    return !(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
    ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
    return ret;
}

function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
    ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
    return ret;
}

/** GCJ-02 → WGS-84；境外坐标原样返回（与 Python 的 out_of_china 判定一致）。 */
export function gcj02ToWgs84(lon, lat) {
    if (outOfChina(lon, lat)) return [lon, lat];
    let dLat = transformLat(lon - 105.0, lat - 35.0);
    let dLng = transformLng(lon - 105.0, lat - 35.0);
    const radLat = (lat / 180.0) * PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
    dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
    const mgLat = lat + dLat;
    const mgLng = lon + dLng;
    return [lon * 2 - mgLng, lat * 2 - mgLat];
}

/** WGS-84 → GCJ-02（原 coordTransform_utils.wgs84_to_gcj02 的等价实现；只用于测试里反向构造样本）。 */
export function wgs84ToGcj02(lon, lat) {
    if (outOfChina(lon, lat)) return [lon, lat];
    let dLat = transformLat(lon - 105.0, lat - 35.0);
    let dLng = transformLng(lon - 105.0, lat - 35.0);
    const radLat = (lat / 180.0) * PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
    dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
    return [lon + dLng, lat + dLat];
}

// ---------------------------------------------------------------------------
// 最小 ZIP 解析（只做读取：中央目录 → 本地头 → 解压）
// ---------------------------------------------------------------------------
function readU16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/** 解出 ZIP 的 { 文件名: 解压后的字节 }；遇到不支持的压缩方法或损坏结构直接报错。 */
function readZipEntries(bytes) {
    if (bytes.length < 22) throw new Error('KMZ 不是有效的 ZIP：文件太短');
    let eocd = -1;
    const stop = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= stop; i -= 1) {
        if (readU32(bytes, i) === SIG_EOCD) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('KMZ 不是有效的 ZIP：找不到目录结尾记录');

    const count = readU16(bytes, eocd + 10);
    const centralOffset = readU32(bytes, eocd + 16);
    if (centralOffset === 0xffffffff || count === 0xffff) throw new Error('KMZ 用了 ZIP64 格式，暂不支持');

    const entries = new Map();
    let cursor = centralOffset;
    for (let index = 0; index < count; index += 1) {
        if (readU32(bytes, cursor) !== SIG_CENTRAL) throw new Error('KMZ 不是有效的 ZIP：中央目录损坏');
        const method = readU16(bytes, cursor + 10);
        const compressedSize = readU32(bytes, cursor + 20);
        const nameLength = readU16(bytes, cursor + 28);
        const extraLength = readU16(bytes, cursor + 30);
        const commentLength = readU16(bytes, cursor + 32);
        const localOffset = readU32(bytes, cursor + 42);
        const name = new TextDecoder('utf-8').decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

        if (readU32(bytes, localOffset) !== SIG_LOCAL) throw new Error(`KMZ 不是有效的 ZIP：条目 ${name} 的本地头损坏`);
        const localNameLength = readU16(bytes, localOffset + 26);
        const localExtraLength = readU16(bytes, localOffset + 28);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const raw = bytes.subarray(dataStart, dataStart + compressedSize);

        if (method === 0) entries.set(name, raw);
        else if (method === 8) {
            try {
                entries.set(name, inflateRawSync(raw));
            } catch {
                throw new Error(`KMZ 条目 ${name} 解压失败（deflate 数据损坏）`);
            }
        } else throw new Error(`KMZ 条目 ${name} 使用了不支持的压缩方法 ${method}（只支持 store/deflate）`);

        cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

// ---------------------------------------------------------------------------
// 最小 XML 解析器（命名空间感知，只覆盖 KML 需要的部分）
// ---------------------------------------------------------------------------
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
            if (!Number.isFinite(code)) throw new Error(`KML 里有无法解析的字符实体 ${whole}`);
            return String.fromCodePoint(code);
        }
        const mapped = ENTITIES[body];
        if (mapped === undefined) throw new Error(`KML 里有未支持的实体 ${whole}`);
        return mapped;
    });
}

/** 解析 XML 文本 → 根元素 { name, ns, attrs, children, text }。 */
function parseXml(source) {
    const root = { name: '#document', ns: '', attrs: {}, children: [], text: null, nsMap: { '': '', xml: 'http://www.w3.org/XML/1998/namespace' } };
    const stack = [root];
    let i = 0;
    const length = source.length;

    const current = () => stack[stack.length - 1];

    while (i < length) {
        const lt = source.indexOf('<', i);
        if (lt < 0) {
            if (i < length) pushText(current(), decodeEntities(source.slice(i)));
            break;
        }
        if (lt > i) pushText(current(), decodeEntities(source.slice(i, lt)));

        if (source.startsWith('<!--', lt)) {
            const end = source.indexOf('-->', lt + 4);
            if (end < 0) throw new Error('KML 不是良构的 XML：注释没有结束');
            i = end + 3;
            continue;
        }
        if (source.startsWith('<![CDATA[', lt)) {
            const end = source.indexOf(']]>', lt + 9);
            if (end < 0) throw new Error('KML 不是良构的 XML：CDATA 没有结束');
            // CDATA 原样保留（ElementTree 行为：不在这里再做实体解码）
            pushText(current(), source.slice(lt + 9, end));
            i = end + 3;
            continue;
        }
        if (source.startsWith('<?', lt)) {
            const end = source.indexOf('?>', lt + 2);
            if (end < 0) throw new Error('KML 不是良构的 XML：处理指令没有结束');
            i = end + 2;
            continue;
        }
        if (source.startsWith('<!', lt)) {
            // <!DOCTYPE ...> 之类：跳到对应的 '>'（KML 里极少见，带内部子集的情况不处理）
            const end = source.indexOf('>', lt + 2);
            if (end < 0) throw new Error('KML 不是良构的 XML：声明没有结束');
            i = end + 1;
            continue;
        }
        if (source.startsWith('</', lt)) {
            const end = source.indexOf('>', lt + 2);
            if (end < 0) throw new Error('KML 不是良构的 XML：结束标签没有闭合');
            const rawName = source.slice(lt + 2, end).trim();
            const element = stack.pop();
            if (!element || element.name === '#document' || element.rawName !== rawName) {
                throw new Error(`KML 不是良构的 XML：结束标签 </${rawName}> 与开始标签不匹配`);
            }
            i = end + 1;
            continue;
        }

        // 开始标签：找到不在引号里的 '>'
        let j = lt + 1;
        let quote = '';
        while (j < length) {
            const ch = source[j];
            if (quote) {
                if (ch === quote) quote = '';
            } else if (ch === '"' || ch === "'") quote = ch;
            else if (ch === '>') break;
            j += 1;
        }
        if (j >= length) throw new Error('KML 不是良构的 XML：开始标签没有闭合');

        const inner = source.slice(lt + 1, j);
        const selfClosing = inner.endsWith('/');
        const body = selfClosing ? inner.slice(0, -1) : inner;
        const nameMatch = /^([^\s/>]+)\s*/.exec(body);
        if (!nameMatch) throw new Error('KML 不是良构的 XML：标签名缺失');
        const rawName = nameMatch[1];
        const attrs = {};
        const attrPattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        attrPattern.lastIndex = nameMatch[0].length;
        let attrMatch;
        while ((attrMatch = attrPattern.exec(body))) {
            const value = attrMatch[3] !== undefined ? attrMatch[3] : attrMatch[4];
            attrs[attrMatch[1]] = decodeEntities(value);
        }

        const parent = current();
        const nsMap = { ...parent.nsMap };
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'xmlns') nsMap[''] = value;
            else if (key.startsWith('xmlns:')) nsMap[key.slice(6)] = value;
        }
        const colon = rawName.indexOf(':');
        const prefix = colon >= 0 ? rawName.slice(0, colon) : '';
        const name = colon >= 0 ? rawName.slice(colon + 1) : rawName;
        const ns = prefix ? nsMap[prefix] ?? '' : nsMap[''] ?? '';

        const element = { rawName, name, ns, attrs, children: [], text: null, nsMap };
        parent.children.push(element);
        if (!selfClosing) stack.push(element);
        i = j + 1;
    }

    if (stack.length !== 1) throw new Error(`KML 不是良构的 XML：元素 <${current().rawName}> 没有闭合`);
    const documentElement = root.children[0];
    if (!documentElement) throw new Error('KML 不是良构的 XML：没有根元素');
    return documentElement;
}

/** 记录字符数据：ElementTree 的 element.text 只保留第一个子元素之前的文本。 */
function pushText(element, text) {
    if (element.children.length > 0) return; // 之后的是 tail，Python 代码不读
    element.text = (element.text ?? '') + text;
}

// ---------------------------------------------------------------------------
// KML → GeoJSON（严格对齐 Python 的遍历与覆盖顺序）
// ---------------------------------------------------------------------------
function isKml(element, name) {
    return element.ns === KML_NS && element.name === name;
}

/** 后代元素（任意深度，文档顺序），等价 ElementTree 的 iterfind('.//{ns}tag')。 */
function descendants(element, name, out = []) {
    for (const child of element.children) {
        if (isKml(child, name)) out.push(child);
        descendants(child, name, out);
    }
    return out;
}

/** 直接子元素里的第一个同名元素，等价 ElementTree 的 find('{ns}tag')。 */
function directChild(element, name) {
    return element.children.find((child) => isKml(child, name)) ?? null;
}

/** 后代里的第一个同名元素，等价 ElementTree 的 find('.//{ns}tag')。 */
function firstDescendant(element, name) {
    for (const child of element.children) {
        if (isKml(child, name)) return child;
        const found = firstDescendant(child, name);
        if (found) return found;
    }
    return null;
}

function coordinatesText(element, owner) {
    const coordinates = directChild(element, 'coordinates');
    if (!coordinates || coordinates.text === null) throw new Error(`KML 的 ${owner} 缺少 coordinates`);
    return coordinates.text.trim();
}

function toNumber(raw, owner) {
    const value = Number(raw);
    if (raw.trim() === '' || Number.isNaN(value)) throw new Error(`KML 的 ${owner} 坐标不是数字：${raw}`);
    return value;
}

/** "a,b[,c]" → [a,b]（Python 用 tuple(map(float,…))[:2]） */
function pairOf(chunk, owner) {
    const parts = chunk.split(',');
    if (parts.length < 2) throw new Error(`KML 的 ${owner} 坐标段不足两段：${chunk}`);
    return [toNumber(parts[0], owner), toNumber(parts[1], owner)];
}

/** 空白分点 → [[x,y], …]（LineString / Polygon 共用，不做 GCJ 转换） */
function readRing(text, owner) {
    const chunks = text.split(/\s+/).filter((chunk) => chunk !== '');
    if (chunks.length === 0) throw new Error(`KML 的 ${owner} coordinates 为空`);
    return chunks.map((chunk) => pairOf(chunk, owner));
}

function placemarkGeometry(placemark) {
    let geometry = null;

    for (const point of descendants(placemark, 'Point')) {
        const text = coordinatesText(point, 'Point');
        const parts = text.split(',');
        // Python: lon, lat, _ = map(float, coords.split(',')) —— 必须正好 3 段
        if (parts.length !== 3) throw new Error(`KML 的 Point 坐标必须是「经度,纬度,高度」三段，实际 ${parts.length} 段`);
        const lon = toNumber(parts[0], 'Point');
        const lat = toNumber(parts[1], 'Point');
        const [x, y] = gcj02ToWgs84(lon, lat);
        geometry = { type: 'Point', coordinates: [x, y] };
    }

    for (const lineString of descendants(placemark, 'LineString')) {
        const points = readRing(coordinatesText(lineString, 'LineString'), 'LineString');
        if (points.length < 2) throw new Error('KML 的 LineString 至少需要 2 个点');
        geometry = { type: 'LineString', coordinates: points };
    }

    for (const polygon of descendants(placemark, 'Polygon')) {
        const outerBoundary = firstDescendant(polygon, 'outerBoundaryIs');
        if (!outerBoundary) continue; // Python: 没有 outerBoundaryIs 就跳过（不覆盖 geometry）
        const coordinates = firstDescendant(outerBoundary, 'coordinates');
        if (!coordinates || coordinates.text === null) throw new Error('KML 的 Polygon 缺少 coordinates');
        const points = readRing(coordinates.text.trim(), 'Polygon');
        if (points.length < 3) throw new Error('KML 的 Polygon 至少需要 3 个点');
        // shapely/GEOS 会闭合外环：首点与末点不同则补一个首点
        const [firstX, firstY] = points[0];
        const [lastX, lastY] = points[points.length - 1];
        const ring = firstX === lastX && firstY === lastY ? points : [...points, [firstX, firstY]];
        geometry = { type: 'Polygon', coordinates: [ring] };
    }

    return geometry;
}

function kmlToGeojson(root) {
    const features = [];
    for (const placemark of descendants(root, 'Placemark')) {
        const properties = {};
        for (const name of descendants(placemark, 'name')) properties.name = name.text;
        for (const description of descendants(placemark, 'description')) properties.description = description.text;

        const geometry = placemarkGeometry(placemark);
        if (geometry === null) continue; // Python 丢弃无几何的 Placemark

        features.push({ type: 'Feature', properties, geometry });
    }
    return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------
/**
 * KMZ 字节 → GeoJSON 对象 { type:'FeatureCollection', features:[…] }。
 * @param {Uint8Array|ArrayBuffer|Buffer} input KMZ 文件内容
 */
export function convertKmzToGeojson(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!bytes || bytes.length === 0) throw new Error('KMZ 文件为空');

    const entries = readZipEntries(bytes);
    const kmlBytes = entries.get('doc.kml');
    if (!kmlBytes) throw new Error('KMZ 里没有 doc.kml');

    const kml = new TextDecoder('utf-8').decode(kmlBytes);
    const root = parseXml(kml);
    return kmlToGeojson(root);
}
