import type { DataSource } from './types';

const sources = new Map<string, DataSource>();

export function register<T>(source: DataSource<T>): void {
    sources.set(source.name, source as DataSource);
}

export function get<T>(name: string): DataSource<T> | undefined {
    return sources.get(name) as DataSource<T> | undefined;
}

export function getAll(): DataSource[] {
    return Array.from(sources.values());
}
