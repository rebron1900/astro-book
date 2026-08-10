import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StatusDom = ReturnType<typeof createStatusDom>;

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

    it('Astro 客户端导航后立即恢复最后收到的状态', async () => {
        let dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        expect(FakeWebSocket.instances).toHaveLength(1);
        FakeWebSocket.instances[0].receive({ process: 'Chrome' });
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

    it('显示项目配置中允许的 Hermes 状态', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        FakeWebSocket.instances[0].receive({ process: 'Hermes' });
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBe('hermes');
        expect(dom.root.style.display).toBe('block');
        expect(dom.image.alt).toBe('Hermes');
    });

    it('动画期间收到未允许状态时不会恢复旧图标', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        FakeWebSocket.instances[0].receive({ process: 'Chrome' });
        FakeWebSocket.instances[0].receive({ process: 'NotAllowed' });
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBeUndefined();
        expect(dom.root.classList.contains('exit')).toBe(true);
    });

    it('从未允许状态回到同一应用时重新显示图标', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);
        await vi.advanceTimersByTimeAsync(0);

        FakeWebSocket.instances[0].receive({ process: 'Chrome' });
        await vi.advanceTimersByTimeAsync(500);
        FakeWebSocket.instances[0].receive({ process: 'NotAllowed' });
        FakeWebSocket.instances[0].receive({ process: 'Chrome' });
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

        FakeWebSocket.instances[0].receive({ process: 'Chrome' });
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
                        if (url.includes('chrome.png')) resolveChrome = () => resolve({});
                        if (url.includes('word.png')) resolveHermes = () => resolve({});
                    })
            )
        );

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);

        FakeWebSocket.instances[0].receive({ process: 'Chrome' });
        FakeWebSocket.instances[0].receive({ process: 'Hermes' });
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

        oldSocket.receive({ process: 'Chrome' });
        await vi.advanceTimersByTimeAsync(500);
        oldSocket.fail();

        // 报错后的 Astro 导航会在旧连接 close 事件到达前创建新连接。
        initWebSocket([{ setContent: vi.fn() }]);
        const newSocket = FakeWebSocket.instances[1];
        newSocket.receive({ process: 'Hermes' });
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
        FakeWebSocket.instances[0].receive({ process: 'Hermes' });

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

        FakeWebSocket.instances[0].receive({ process: 'Chrome' });
        await vi.advanceTimersByTimeAsync(500);
        FakeWebSocket.instances[0].receive({ process: 'Hermes' });
        FakeWebSocket.instances[0].receive({ process: 'Chrome' });
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBe('chrome');
        expect(dom.root.classList.contains('exit')).toBe(false);
        expect(dom.image.alt).toBe('Chrome');
    });

    it('process 为空时使用 title 匹配应用', async () => {
        const dom = createStatusDom();
        installBrowserBoundaries(() => dom);

        const { default: initWebSocket } = await import('../../src/lib/client/actives');
        initWebSocket([{ setContent: vi.fn() }]);

        FakeWebSocket.instances[0].receive({
            type: 'current_process',
            timestamp: '',
            process: '',
            title: '微信',
            media: ''
        });
        await vi.advanceTimersByTimeAsync(500);

        expect(dom.root.dataset.app).toBe('wechat');
        expect(dom.root.style.display).toBe('block');
        expect(dom.root.classList.contains('exit')).toBe(false);
        expect(dom.image.alt).toBe('微信');
    });
});
