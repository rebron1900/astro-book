// 定义测试用的URL
// const wsUrl = "ws://localhost:8081/update";
// const appListUrl = "http://localhost:8080/assets/app.json";

// 定义正式环境的url
const cdn = "https://cdn.1900.live/apps/";
const wsUrl = "wss://api.1900.live/actives_ws";
const appListUrl = "https://1900.live/assets/app.json";

// app白名单
let appList = {};
// 保存WebSocket实例的变量
let ws2;

// 初始化WebSocket连接
export default function initWebSocket() {
    // 获取远端的app清单
    fetch(appListUrl).then((rep) => {
        rep.json().then((data) => {
            ws2 = new WebSocket(wsUrl);
            // 初始化app列表
            appList = data;
            // 绑定事件处理函数
            ws2.onopen = onOpen;
            ws2.onmessage = onMessage;
            ws2.onclose = onClose;
            ws2.onerror = onError;
        });
    });
}

// 连接成功的处理函数
function onOpen(event) {
    // console.log("WebSocket connection opened:", event);
    // 可以在这里发送消息等操作
}

// 接收到消息的处理函数
function onMessage(event) {
    // 接受服务端下发的程序数据
    var data = JSON.parse(event.data);
    // 获取页面上actives dom元素
    var activs = document.querySelector(".actives");
    // 之后用来判断的进程名称统一小写，方便比对
    const processName = data.process.toLowerCase();

    // 处理接收到的消息
    // 条件为：当前页面显示的app和服务器下发的app要不一样（说明是新程序），并且程序在app清单中。
    if (activs.dataset.app != data.process && processName in appList) {
        // 提前缓存图片（我发现大佬博客图片加载有颜值，不过不知道这个有用没有）
        fetch(cdn + appList[processName].url + "!20w").then(function () {
            // 先将旧的actives执行退场动画
            activs.style.display = "block";
            activs.classList.add("exit");
            // 0.5s后执行更新操作
            setTimeout(function() {
                // 重新设置icon
                document.querySelector(".actives img").src =
                    cdn + appList[processName].url + "!20w";
                // 执行进场动画
                activs.classList.remove("exit");
                // 更新dom上app的信息
                activs.dataset.app = processName;
                // 这里我用Tippy.js做鼠标悬浮提示，更新悬浮提示内容
                activeTippy.forEach(function (e) {
                    e.setContent(
                        "@1900 在使用 " +
                            appList[processName].title +
                            " " +
                            appList[processName].action
                    );
                });
            }, 500);
        });
    // 如果是不在白名单里的应用就不显示actives元素了
    } else if (!(processName in appList)) {
        activs.classList.add("exit");
    }
}

// 连接关闭的处理函数
function onClose(event) {
    // 尝试重新连接
    document.querySelector(".actives").classList.add("exit");
    setTimeout(initWebSocket, 5000); // 5秒后尝试重新连接
}

// 连接错误的处理函数
function onError(event) {
    // 尝试重新连接
    document.querySelector(".actives").classList.add("exit");
}
