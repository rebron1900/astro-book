/**
 * 契约校验器（不引依赖，纯函数）。
 *
 * 只做三件事：版本一致性、字段类型、ID 唯一 + 排序后置条件。
 * 错误信息只带条目 id / 字段名 / 下标，不带正文（数据里可能有敏感内容）。
 *
 * 契约形状（见 contracts.mjs）：
 *   { version, file, writeMode: 'replace'|'merge'|'append', key?, allowEmpty, shape?: 'list'|'map'|'object',
 *     item: { 字段: 'type' | 'type?' }, mapKeyPrefixes?: string[], orderBy?, orderDir?,
 *     fields?: { 字段: 'type' | { type:'array', item?, key?, allowEmpty?, orderBy?, orderDir? } }, countField? }
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
    for (const [field, spec] of Object.entries(fields || {})) {
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

/** 字段描述是不是「数组字段」（对象形状里的 { type:'array', ... }）。 */
function isArraySpec(spec) {
    return Boolean(spec) && typeof spec === 'object' && String(spec.type || '').replace(/\?$/, '') === 'array';
}

/** 列表契约的主键字段：显式 null/'' 表示不做唯一性校验；省略时沿用历史的 'id'。 */
function listKeyOf(contract) {
    if (contract.key === null || contract.key === '') return null;
    return contract.key || 'id';
}

/** 数组字段的主键：省略即不校验（reading.books / geojson.features 没有稳定 id）。 */
function arrayKeyOf(spec) {
    return isArraySpec(spec) ? spec.key || null : null;
}

/** 收集已通过校验的记录主键（只用于报告；数字主键（neodb post_id）按字符串归一）。 */
function collectIds(records, keyField) {
    if (!keyField) return [];
    return records
        .map((record) => (record && typeof record === 'object' ? record[keyField] : undefined))
        .filter((key) => (typeof key === 'string' && key !== '') || typeof key === 'number')
        .map((key) => String(key));
}

/** 排序违规的首条描述；无违规返回 null。direction: 'asc'|'desc'。 */
function firstOrderViolation(records, field, direction) {
    for (let i = 1; i < records.length; i += 1) {
        const prev = Number(records[i - 1]?.[field] ?? 0);
        const cur = Number(records[i]?.[field] ?? 0);
        const broken = direction === 'asc' ? prev > cur : prev < cur;
        if (broken) {
            const word = direction === 'asc' ? '升序' : '降序';
            return `排序后置条件不满足：第 ${i} 条 ${field}=${cur} ${direction === 'asc' ? '小于' : '大于'}前一条 ${prev}（要求${word}）`;
        }
    }
    return null;
}

/**
 * 校验对象字段：类型串或数组描述。
 * 数组描述额外做：非空、item 字段校验、主键唯一、排序后置条件。
 */
function validateFieldValue(value, spec, label) {
    if (typeof spec === 'string') {
        const { union, optional, raw } = parseFieldType(spec);
        if (value === undefined) return optional ? [] : [`${label} 缺失（要求 ${raw}）`];
        const type = actualType(value);
        return union.includes(type) ? [] : [`${label} 类型是 ${type}，要求 ${raw}`];
    }
    const field = spec || {};
    const { union, optional, raw } = parseFieldType(field.type === undefined ? 'array' : String(field.type));
    if (value === undefined) return optional ? [] : [`${label} 缺失（要求 ${raw}）`];
    const type = actualType(value);
    const errors = [];
    if (!union.includes(type)) {
        errors.push(`${label} 类型是 ${type}，要求 ${raw}`);
        return errors;
    }
    if (type !== 'array' || !isArraySpec(field)) return errors;
    if (field.allowEmpty === false && value.length === 0) errors.push(`${label} 为空数组（契约要求非空）`);
    if (field.item) {
        value.forEach((record, index) => {
            for (const error of validateFields(record, field.item)) errors.push(`${label}[${index}]: ${error}`);
        });
    }
    const keyField = arrayKeyOf(field);
    if (keyField) {
        const seen = new Set();
        value.forEach((record, index) => {
            const key = record && typeof record === 'object' ? record[keyField] : undefined;
            const usable = (typeof key === 'string' && key !== '') || typeof key === 'number';
            if (!usable) {
                errors.push(`${label}[${index}]: 缺少主键 ${keyField}`);
                return;
            }
            const normalized = String(key);
            if (seen.has(normalized)) errors.push(`${label}[${index}]: 重复的主键 ${keyField}=${normalized}`);
            else seen.add(normalized);
        });
    }
    if (field.orderBy) {
        const problem = firstOrderViolation(value, field.orderBy, field.orderDir === 'asc' ? 'asc' : 'desc');
        if (problem) errors.push(`${label} ${problem}`);
    }
    return errors;
}

/** 校验一份输出（数组 / 扁平映射 / 对象），返回 { ok, errors, count, ids }。 */
export function validateDataset(datasetId, data, contractOrAll) {
    const contract = contractOrAll && contractOrAll.version !== undefined ? contractOrAll : getContract(datasetId, contractOrAll);
    const errors = [];
    const ids = [];
    const isMap = contract.shape === 'map';
    const isObject = contract.shape === 'object';

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

    // object 型：顶层是对象，按 fields 逐字段校验；未声明字段放行（rank 这类上游形状会变）
    if (isObject) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return { ok: false, errors: ['object 型 dataset 必须是对象'], count: 0, ids };
        }
        for (const [name, spec] of Object.entries(contract.fields || {})) {
            for (const error of validateFieldValue(data[name], spec, `字段 ${name}`)) errors.push(error);
            if (isArraySpec(spec) && Array.isArray(data[name])) ids.push(...collectIds(data[name], arrayKeyOf(spec)));
        }
        const countValue = contract.countField ? data[contract.countField] : undefined;
        // countField 声明的数组长度就是「条数」；未声明（或该字段不是数组）时退回顶层键数
        const count = contract.countField && Array.isArray(countValue) ? countValue.length : Object.keys(data).length;
        return { ok: errors.length === 0, errors, count, ids };
    }

    if (!Array.isArray(data)) {
        return { ok: false, errors: ['list 型 dataset 必须是数组'], count: 0, ids };
    }
    const keyField = listKeyOf(contract);
    const seen = new Set();
    data.forEach((record, index) => {
        const fieldErrors = validateFields(record, contract.item);
        for (const error of fieldErrors) errors.push(`#${index}: ${error}`);
        if (!keyField) return;
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

    // 排序后置条件：契约声明 orderBy 时，输出必须按该字段排序（默认降序，orderDir:'asc' 为升序）
    if (contract.orderBy) {
        const problem = firstOrderViolation(data, contract.orderBy, contract.orderDir === 'asc' ? 'asc' : 'desc');
        if (problem) errors.push(problem);
    }

    return { ok: errors.length === 0, errors, count: data.length, ids };
}
