import { deflateRawSync } from 'node:zlib';

/**
 * 测试用的最小 ZIP 构造器（只为造 KMZ 用，不引第三方库）。
 *
 * 只实现两种压缩方法：store(0) 与 deflate(8)；其它方法值允许显式写入，用来测「不支持的方法」。
 * 不写 data descriptor：中央目录里的 mtime 写死，产物可复现。
 */

export type ZipEntry = { name: string; data: string | Uint8Array; method?: number };

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function toBytes(value: string | Uint8Array): Uint8Array {
    return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

/** 造一个 ZIP 文件（Buffer）。method 默认 8（deflate）；传 0 即为 store。 */
export function buildZip(entries: ZipEntry[]): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = new TextEncoder().encode(entry.name);
        const raw = toBytes(entry.data);
        const method = entry.method ?? 8;
        const payload = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
        const crc = crc32(raw);

        const local = Buffer.alloc(30 + nameBytes.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0, 6); // flags
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0, 10); // time
        local.writeUInt16LE(0x21, 12); // date（1980-01-01，固定值）
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        local.writeUInt16LE(0, 28);
        Buffer.from(nameBytes).copy(local, 30);
        locals.push(local, Buffer.from(payload));

        const central = Buffer.alloc(46 + nameBytes.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4); // version made by
        central.writeUInt16LE(20, 6); // version needed
        central.writeUInt16LE(0, 8); // flags
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0x21, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt16LE(0, 30); // extra
        central.writeUInt16LE(0, 32); // comment
        central.writeUInt16LE(0, 34); // disk
        central.writeUInt16LE(0, 36); // internal attrs
        central.writeUInt32LE(0, 38); // external attrs
        central.writeUInt32LE(offset, 42);
        Buffer.from(nameBytes).copy(central, 46);
        centrals.push(central);

        offset += local.length + payload.length;
    }

    const centralBuffer = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...locals, centralBuffer, end]);
}

/** KML 字符串 → KMZ 字节（默认 deflate；method:0 为 store）。 */
export function kmzOf(kml: string, method: 0 | 8 = 8, extraEntries: ZipEntry[] = []): Buffer {
    return buildZip([{ name: 'doc.kml', data: kml, method }, ...extraEntries]);
}

/** KML 外壳：固定 KML 2.2 命名空间。 */
export function kml(placemarks: string, { head = '' } = {}): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    ${head}
    ${placemarks}
  </Document>
</kml>`;
}

export function placemark(inner: string): string {
    return `<Placemark>${inner}</Placemark>`;
}
