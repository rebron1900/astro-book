# 客户端脚本约定

页面脚本按「用途」分三处放：

- `src/lib/client/*.ts`：浏览器专用、带 DOM 副作用的模块（zoom、toc、搜索、无限滚动等），默认导出 `initXxx()`。
- `src/lib/*.ts`：构建期与浏览器都能用的纯函数（`exercise.ts`、`strava-preview.ts`、`metric-icons.ts` 等），不要在这里碰 `document`。
- 组件里的 `<script>`：只做「取 DOM → 调 init」的薄封装；`<script is:inline>` 仅用于必须在首屏同步执行、或需要 `define:vars` 注入数据的情况。

## 挂载

一律用 `onPageLoad()`（`src/lib/client/mount.ts`），不要再手写
`document.addEventListener('astro:page-load', ...)` + `if (document.readyState !== 'loading')` 这种双重初始化：

```ts
import { onPageLoad } from '../../lib/client/mount';
onPageLoad(initSomething);        // 首次加载 + 每次导航后各执行一次
```

需要清理的（window 监听、observer、第三方实例）返回清理函数即可，导航前会自动调用：

```ts
onPageLoad(() => {
    const onScroll = () => {};
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
});
```

`is:inline` 脚本无法 import，仍需自己用「元素 dataset 标记 + `astro:before-swap` 清理」的写法。

## 已有的共享模块

- `mount.ts`：`onPageLoad()` 页面挂载/清理。
- `timeline.ts`：首页/时间线页的全部交互（无限滚动、memo 展开、图片堆叠画廊、滚动渐入），`List.astro` 只保留三行挂载代码。
- `tippy.ts`：`createTippy()` / `destroyAllTippy()`，统一管理 tippy 实例并在导航前销毁。
- `dom.ts`：`escapeHtml()` / `prefersReducedMotion()` / `onNextFrame()`。
- `toc-view-transition.ts`：右侧栏（`.book-toc-content`）的 View Transition 命名时机。侧栏带 `transition:name` 后会独立成组，只在前后两页都有侧栏时保留这个名字，否则（进/出相册、友链这类没有侧栏的宽样式页）并回整页快照，避免侧栏在新页面上闪一下再消失。靠 `astro:before-preparation` 里包装 `event.loader`，在 `startViewTransition` 之前拿到目标文档。

## 常用小工具

- `footprint-map.ts`：足迹地图控制器（独立 Mapbox 实例、标点聚合、卡片联动、`destroy()`）；和运动预览地图的 `exercise-map.ts` 互不 import。
- `src/lib/client/dom.ts`：`escapeHtml()`、`prefersReducedMotion()`、`onNextFrame()`。
- 格式化/日期/配速等纯函数在 `src/lib/exercise.ts`，不要在组件或 `strava-preview.ts` 里再抄一份。
