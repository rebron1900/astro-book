/**
 * 共享类型：Mock fetch 响应构造器
 */
import { vi } from 'vitest';

/** 构造一个成功的 JSON 响应 */
export function okResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status });
}

/** 构造一个失败的响应 */
export function errorResponse(status: number, statusText = ''): Response {
    return new Response(null, { status, statusText });
}

/** 用给定的模拟响应替换全局 fetch */
export function mockFetchOnce(response: Response): void {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response)));
}

/** 用按 URL 映射的模拟响应替换全局 fetch */
export function mockFetchWithMap(
    map: Record<string, Response | (() => Response)>,
    fallback?: () => Response
): void {
    vi.stubGlobal(
        'fetch',
        vi.fn((url: string | URL | Request) => {
            const key = url.toString();
            if (map[key]) {
                const val = map[key];
                return Promise.resolve(typeof val === 'function' ? val() : val);
            }
            if (fallback) return Promise.resolve(fallback());
            return Promise.reject(new Error(`unexpected fetch: ${key}`));
        })
    );
}

/** 清理全局 fetch mock */
export function resetFetch(): void {
    vi.unstubAllGlobals();
}
