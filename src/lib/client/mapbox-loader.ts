/**
 * mapbox-gl 按需加载。
 *
 * mapbox-gl 的 JS 有 1.38MB（gzip 374KB）、CSS 36KB。以前是静态 import：
 * 运动页一进首屏就要下载、解析、执行这一坨，换页那几百毫秒直接变成几秒。
 *
 * 现在地图本来就在 `afterTransition()`（换页动画结束 + 浏览器空闲）里才创建，
 * 所以把 JS/CSS 一起挪到这里：地图要起的时候才下载，两个运动页共用一个 promise
 * （足迹和运动共用一个 chunk，切模式不会重复下载）。
 */
type MapboxModule = typeof import('mapbox-gl/dist/mapbox-gl.js');

/** mapbox-gl 默认导出（就是 mapboxgl 命名空间对象） */
export type MapboxAPI = MapboxModule['default'];

let loading: Promise<MapboxAPI> | null = null;

export function loadMapbox(): Promise<MapboxAPI> {
    if (!loading) {
        loading = Promise.all([
            import('mapbox-gl/dist/mapbox-gl.js'),
            // 样式跟着 JS 一起到，避免地图先出来一帧没有控件的裸 canvas
            import('mapbox-gl/dist/mapbox-gl.css')
        ])
            .then(([mod]) => mod.default)
            .catch((error) => {
                // 失败不缓存：下次可见/切模式还能重试（地图控制器自己也会降级提示）
                loading = null;
                throw error;
            });
    }
    return loading;
}
