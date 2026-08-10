// 定义测试用的URL
// const wsUrl = 'ws://localhost:8081/update';

// 定义正式环境的url
const wsUrl = 'wss://hapi.190102.xyz:4433/ws/pc-status';

interface ActiveApp {
    id: string;
    title: string;
    url: string;
    action?: string;
}

interface ActiveMessage {
    app?: ActiveApp | null;
}

// 保存WebSocket实例的变量
let ws2: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let activesTippy: Array<{ setContent: (content: string) => void }> | null = null;
let currentApp: ActiveApp | null = null;

// 初始化WebSocket连接
export default function initWebSocket(actives: Array<{ setContent: (content: string) => void }>) {
    activesTippy = actives;

    // Astro 客户端导航会重建 Brand DOM，但模块级 WebSocket 会继续存在。
    // 将最后收到的状态立即恢复到新 DOM，避免等待下一次 PC 上报。
    if (currentApp) {
        renderActive(currentApp, false);
    }

    if (!ws2) {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        const socket = new WebSocket(wsUrl);
        ws2 = socket;
        socket.onopen = onOpen;
        socket.onmessage = (event) => {
            if (ws2 === socket) onMessage(event);
        };
        socket.onclose = () => handleDisconnect(socket);
        socket.onerror = () => handleDisconnect(socket);
    }
}

// 连接成功的处理函数
function onOpen(_event: Event) {
    // console.log("WebSocket connection opened:", event);
    // 可以在这里发送消息等操作
}

// 接收到消息的处理函数
function onMessage(event: MessageEvent) {
    // HAPI 已完成白名单判定并下发可信的完整应用信息；前端只负责展示。
    const data: ActiveMessage = JSON.parse(event.data);
    const app = getRenderableApp(data);

    if (!app) {
        hideActive();
        return;
    }

    // 状态先于 DOM 更新：Astro 导航替换 Brand 的短暂窗口内也不能丢消息。
    currentApp = app;
    const activs = document.querySelector<HTMLElement>('.actives');
    if (!activs || activs.dataset.app === app.id) return;

    renderActive(app, true);
}

function getRenderableApp(data: ActiveMessage) {
    const app = data.app;
    if (!app || typeof app.id !== 'string' || typeof app.title !== 'string' || typeof app.url !== 'string') {
        return null;
    }
    return app;
}

function hideActive() {
    currentApp = null;
    const activs = document.querySelector<HTMLElement>('.actives');
    if (!activs) return;

    delete activs.dataset.app;
    activs.classList.add('exit');
}

function renderActive(app: ActiveApp, animate: boolean) {
    const activs = document.querySelector<HTMLElement>('.actives');
    if (!activs) return;

    const update = () => {
        // 图片预取和退场动画是异步的，只允许最后收到的状态更新界面。
        if (currentApp !== app) return;

        const img = document.querySelector<HTMLImageElement>('.actives img');
        if (img) {
            img.src = app.url;
            img.alt = app.title;
        }
        activs.classList.remove('exit');
        activs.dataset.app = app.id;
        activesTippy?.forEach((instance) => {
            instance.setContent('@1900 在使用 ' + app.title + ' ' + (app.action ?? ''));
        });
    };

    activs.style.display = 'block';
    if (!animate) {
        update();
        return;
    }

    // 提前缓存图片；即使缓存失败，也继续更新状态图标。
    fetch(app.url)
        .catch((err) => console.warn('[actives] 预缓存图标失败:', err))
        .then(() => {
            if (currentApp !== app) return;

            activs.classList.add('exit');
            setTimeout(update, 500);
        });
}

function handleDisconnect(socket: WebSocket) {
    // 忽略已被新连接替代的旧 socket 事件，避免清空新连接及其状态。
    if (ws2 !== socket) return;

    ws2 = null;
    hideActive();
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        initWebSocket(activesTippy ?? []);
    }, 5000);
}
