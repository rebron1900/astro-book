import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StatusDom = ReturnType<typeof createStatusDom>;

const chromeApp = {
    id: 'chrome',
    title: 'Chrome',
    url: 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/chrome.webp',
    action: '冲浪'
};
const hermesApp = {
    id: 'hermes',
    title: 'Hermes',
    url: 'https://cdn.1900.live/apps/word.png',
    action: '正在和H小姐头脑风暴中...'
};
const wechatApp = {
    id: 'wechat',
    title: '微信',
    url: 'https://cdn.1900.live/apps/wechat.png',
    action: '摸鱼'
};
const centBrowserApp = {
    id: 'centbrowser',
    title: 'Cent Browser',
    url: 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/centbrowser.webp',
    action: '冲浪'
};

function currentProcess(app: typeof chromeApp | typeof hermesApp | typeof wechatApp | typeof centBrowserApp) {
    return {
        type: 'current_process',
        process: app.id,
        title: app.title,
        app
    };
}

function createStatusDom() {
    const classes = new Set<string>();
    return {
        root: {
            dataset: {} as Record<string, string>,
            style: { display: 'none' },
            classList: {
                add: (name: string) => classes.add(name),
                remove: (name: string) => classes.delete(name),
                contains: (name: string) => classes.has(name)
            }
        },
        image: { src: 'placeholder', alt: '' }
    };
}

class FakeWebSocket {
    static instances: FakeWebSocket[] = [];

    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    constructor(public url: string) {
        FakeWebSocket.instances.push(this);
    }

    receive(data: unknown) {
        this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
    }

    disconnect() {
        this.onclose?.({} as CloseEvent);
    }

    fail() {
        this.onerror?.({} as Event);
    }
}

function installBrowserBoundaries(getDom: () => StatusDom | null) {
    vi.stubGlobal('document', {
        querySelector: (selector: string) => {
            const dom = getDom();
            if (!dom) return null;
            if (selector === '.actives') return dom.root;
            if (selector === '.actives img') return dom.image;
            return null;
        }
    });
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({}))
    );
    vi.stubGlobal('WebSocket', FakeWebSocket);
}

describe('PC 状态显示', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        FakeWebSocket.instances = [];
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('直接展示后端返回的完整应用信息', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);

        FakeWebSocket.instances[0].receive(currentProcess(centBrowserApp));
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBe('centbrowser');
        expect(dom.image.alt).toBe('Cent Browser');
        expect(dom.image.src).toBe(centBrowserApp.url);
    });

    it('Astro 客户端导航后立即恢复最后收到的状态', async () => {
        let dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        expect(FakeWebSocket.instances).toHaveLength(1);
        FakeWebSocket.instances[0].receive(currentProcess(chromeApp));
        await vi.advanceTimersByTimeAsync(500);
        expect(dom.root.dataset.app).toBe('chrome');
        expect(dom.root.style.display).toBe('block');

        dom = createStatusDom();
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(dom.root.dataset.app).toBe('chrome');
        expect(dom.root.style.display).toBe('block');
        expect(dom.image.alt).toBe('Chrome');
    });

    it('显示后端下发的 Hermes 状态', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        FakeWebSocket.instances[0].receive(currentProcess(hermesApp));
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBe('hermes');
        expect(dom.root.style.display).toBe('block');
        expect(dom.image.alt).toBe('Hermes');
    });

    it('动画期间收到清空状态时不会恢复旧图标', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        FakeWebSocket.instances[0].receive(currentProcess(chromeApp));
        FakeWebSocket.instances[0].receive({ type: 'current_process', app: null });
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBeUndefined();
        expect(dom.root.classList.contains('exit')).toBe(true);
    });

    it('从清空状态回到同一应用时重新显示图标', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        FakeWebSocket.instances[0].receive(currentProcess(chromeApp));
        await vi.advanceTimersByTimeAsync(500);
        FakeWebSocket.instances[0].receive({ type: 'current_process', app: null });
        FakeWebSocket.instances[0].receive(currentProcess(chromeApp));
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBe('chrome');
        expect(dom.root.classList.contains('exit')).toBe(false);
    });

    it('WebSocket 断线重连时不恢复过期状态', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        FakeWebSocket.instances[0].receive(currentProcess(chromeApp));
        await vi.advanceTimersByTimeAsync(500);
        FakeWebSocket.instances[0].disconnect();
        await vi.advanceTimersByTimeAsync(5000);

        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(dom.root.dataset.app).toBeUndefined();
        expect(dom.root.classList.contains('exit')).toBe(true);
    });

    it('旧图标预取晚完成时不会隐藏较新的状态', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        let resolveChrome!: () => void;
        let resolveHermes!: () => void;
        vi.stubGlobal(
            'fetch',
            vi.fn(
                (url: string) =>
                    new Promise<Record<string, never>>((resolve) => {
                        if (url.includes('chrome.webp')) resolveChrome = () => resolve({});
                        if (url.includes('word.png')) resolveHermes = () => resolve({});
                    })
            )
        );

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);

        FakeWebSocket.instances[0].receive(currentProcess(chromeApp));
        FakeWebSocket.instances[0].receive(currentProcess(hermesApp));
        resolveHermes();
        await vi.advanceTimersByTimeAsync(500);
        expect(dom.root.dataset.app).toBe('hermes');
        expect(dom.root.classList.contains('exit')).toBe(false);

        resolveChrome();
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBe('hermes');
        expect(dom.root.classList.contains('exit')).toBe(false);
    });

    it('旧连接关闭时不会清除新连接的状态', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        const oldSocket = FakeWebSocket.instances[0];

        oldSocket.receive(currentProcess(chromeApp));
        await vi.advanceTimersByTimeAsync(500);
        oldSocket.fail();

        // 报错后的 Astro 导航会在旧连接 close 事件到达前创建新连接。
        initWebSocket([{ setContent: vi.fn() }]);
        const newSocket = FakeWebSocket.instances[1];
        newSocket.receive(currentProcess(hermesApp));
        await vi.advanceTimersByTimeAsync(500);

        oldSocket.disconnect();
        await vi.advanceTimersByTimeAsync(4500);

        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(dom.root.dataset.app).toBe('hermes');
        expect(dom.root.classList.contains('exit')).toBe(false);
    });

    it('导航期间没有 DOM 时仍保存并恢复最新状态', async () => {
        let dom: StatusDom | null = null;
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        FakeWebSocket.instances[0].receive(currentProcess(hermesApp));

        dom = createStatusDom();
        initWebSocket([{ setContent: vi.fn() }]);

        expect(dom.root.dataset.app).toBe('hermes');
        expect(dom.root.style.display).toBe('block');
        expect(dom.image.alt).toBe('Hermes');
    });

    it('快速收到 A→B→A 时保留最后的 A 状态', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);

        FakeWebSocket.instances[0].receive(currentProcess(chromeApp));
        await vi.advanceTimersByTimeAsync(500);
        FakeWebSocket.instances[0].receive(currentProcess(hermesApp));
        FakeWebSocket.instances[0].receive(currentProcess(chromeApp));
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBe('chrome');
        expect(dom.root.classList.contains('exit')).toBe(false);
        expect(dom.image.alt).toBe('Chrome');
    });

    it('app 为空时清除当前状态', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);

        FakeWebSocket.instances[0].receive(currentProcess(wechatApp));
        await vi.advanceTimersByTimeAsync(500);
        FakeWebSocket.instances[0].receive({
            type: 'current_process',
            timestamp: Date.now(),
            process: '',
            title: '',
            app: null
        });

        expect(dom.root.dataset.app).toBeUndefined();
        expect(dom.root.classList.contains('exit')).toBe(true);
    });
});
