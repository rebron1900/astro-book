/**
 * 契约校验器（不引依赖，纯函数）。
 *
 * 只做三件事：版本一致性、字段类型、ID 唯一 + 排序后置条件。
 * 错误信息只带条目 id / 字段名 / 下标，不带正文（数据里可能有敏感内容）。
 *
 * 契约形状（见 contracts.mjs）：
 *   { version, file, writeMode: 'replace'|'merge'|'append', key?, allowEmpty, shape?: 'list'|'map',
 *     item: { 字段: 'type' | 'type?' }, mapKeyPrefixes?: string[] }
 */
import { FIELD_TYPES, getContract } from './contracts.mjs';

/** 解析类型串：'string?' → { type: 'string', optional: true }；支持 'number|null' 这类联合。 */
export function parseFieldType(spec) {
    const raw = String(spec).trim();
    const optional = raw.endsWith('?');
    const base = optional ? raw.slice(0, -1) : raw;
    const union = base.split('|').map((part) => part.trim());
    for (const part of union) {
        if (!FIELD_TYPES.includes(part)) throw new Error(`契约里的字段类型「${spec}」不受支持`);
    }
    return { union, optional, raw };
}

function actualType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'number(NaN)';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'object') return 'object';
    return typeof value;
}

/** 单条记录字段校验；返回错误描述数组（不含值）。 */
export function validateFields(record, fields) {
    const errors = [];
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return ['记录不是对象'];
    }
    for (const [field, spec] of Object.entries(fields)) {
        const { union, optional, raw } = parseFieldType(spec);
        const value = record[field];
        if (value === undefined) {
            if (!optional) errors.push(`字段 ${field} 缺失（要求 ${raw}）`);
            continue;
        }
        const type = actualType(value);
        if (!union.includes(type)) errors.push(`字段 ${field} 类型是 ${type}，要求 ${raw}`);
    }
    return errors;
}

/** 校验一份输出（数组或扁平映射），返回 { ok, errors, count, ids }。 */
export function validateDataset(datasetId, data, contractOrAll) {
    const contract = contractOrAll && contractOrAll.item ? contractOrAll : getContract(datasetId, contractOrAll);
    const errors = [];
    const ids = [];
    const isMap = contract.shape === 'map';

    if (isMap) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return { ok: false, errors: ['map 型 dataset 必须是对象'], count: 0, ids };
        }
        const prefixes = contract.mapKeyPrefixes || [];
        for (const [key, value] of Object.entries(data)) {
            if (prefixes.length && !prefixes.some((prefix) => key.startsWith(prefix))) {
                errors.push(`键 ${key.slice(0, 12)}… 不在允许前缀（${prefixes.join('/')}）内`);
            }
            if (actualType(value) !== 'object') errors.push(`键 ${key.slice(0, 12)}… 的值不是对象`);
        }
        return { ok: errors.length === 0, errors, count: Object.keys(data).length, ids };
    }

    if (!Array.isArray(data)) {
        return { ok: false, errors: ['list 型 dataset 必须是数组'], count: 0, ids };
    }
    const seen = new Set();
    const keyField = contract.key || 'id';
    data.forEach((record, index) => {
        const fieldErrors = validateFields(record, contract.item);
        for (const error of fieldErrors) errors.push(`#${index}: ${error}`);
        const key = record && typeof record === 'object' ? record[keyField] : undefined;
        if (typeof key !== 'string' || key === '') {
            if (!fieldErrors.some((error) => error.includes(keyField))) errors.push(`#${index}: 缺少主键 ${keyField}`);
        } else if (seen.has(key)) {
            errors.push(`重复的主键 ${keyField}=${key}`);
        } else {
            seen.add(key);
            ids.push(key);
        }
    });

    // 排序后置条件：契约声明 orderBy 时，输出必须严格按该字段降序（时间线直接消费，不允许依赖下游再排）
    if (contract.orderBy) {
        const field = contract.orderBy;
        for (let i = 1; i < data.length; i += 1) {
            const prev = Number(data[i - 1]?.[field] ?? 0);
            const cur = Number(data[i]?.[field] ?? 0);
            if (prev < cur) {
                errors.push(`排序后置条件不满足：第 ${i} 条 ${field}=${cur} 大于前一条 ${prev}（要求降序）`);
                break;
            }
        }
    }

    return { ok: errors.length === 0, errors, count: data.length, ids };
}
