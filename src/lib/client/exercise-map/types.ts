/* 运动地图的公开类型与内部数据结构 */
import type { ExerciseRecord, ExerciseScope } from '../../exercise';

export interface PendingFit {
    ids: string[];
    duration: number;
    maxZoom: number;
}

export type RouteFeatureProperties = {
    id: string;
    sport: string;
    color: string;
    date: string;
    month: string;
    year: number;
};

export type Bounds = [[number, number], [number, number]];

export interface RouteData {
    collection: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteFeatureProperties>;
    /** 有轨迹的记录 id */
    ids: Set<string>;
    /** 每条轨迹的 bbox（含最小跨度），切换 scope 时只用祖先 135 个包围盒 */
    bounds: Map<string, Bounds>;
}



export interface ExerciseMapStatus {
    /** 卡片底部提示条文案；null 表示隐藏 */
    message: string | null;
    /** 地图 / 轨迹数据不可用（卡片进入淡化态） */
    unavailable: boolean;
}

export interface ExerciseMapOptions {
    /** 地图挂载的容器（必须是已经渲染到 DOM 里的元素；吸顶时高度不变，只被外层裁切） */
    container: HTMLElement;
    /** 外层可视窗口：吸顶时比容器矮，会以中线为轴裁切；fitBounds 需要把裁掉的部分补进 padding */
    viewport?: HTMLElement;
    /** Mapbox public token */
    token: string;
    /** 轨迹数据接口，返回 { [记录 id]: encodedPolyline } */
    routesUrl: string;
    /** 页面内的精简运动记录 */
    records: ExerciseRecord[];
    /** 点击地图上的路线 */
    onSelectRoute: (id: string) => void;
    /** 地图状态变化（提示文案 / 是否可用） */
    onStatus: (status: ExerciseMapStatus) => void;
    /** 当前范围是否可以重播（单条记录且有轨迹） */
    onReplayAvailable?: (available: boolean) => void;
    /** 重播开始 / 结束 */
    onReplayChange?: (replaying: boolean) => void;
    /** 重播是否在自动播放（暂停 / 拖动进度后会变成 false） */
    onReplayPlayback?: (playing: boolean) => void;
    /** 当前绘制进度 0~1 */
    onReplayProgress?: (progress: number) => void;
}

export interface ExerciseMapController {
    /** 创建地图并加载轨迹；重复调用无副作用 */
    start(): Promise<void>;
    /** 更新当前选中范围 */
    setScope(scope: ExerciseScope): void;
    /** 更新悬停的记录（null 取消高亮） */
    setHover(id: string | null): void;
    /** 地图是否处于吸顶的紧凑状态（2D 范围需要在高度过渡结束后重新取景） */
    setCompact(compact: boolean): void;
    /** 重播当前单条记录的轨迹；正在重播时再次调用会停止并恢复 */
    replay(): void;
    /** 暂停自动绘制，保留当前进度和镜头 */
    pauseReplay(): void;
    /** 从当前进度继续绘制 */
    resumeReplay(): void;
    /** 跳到任意绘制进度（0~1），并同步第一视角镜头 */
    seekReplay(progress: number): void;
    /** 停止重播并恢复地图原有图层与自动旋转 */
    stopReplay(restoreCamera?: boolean): void;
    /** 销毁地图，之后所有方法都变成空操作 */
    destroy(): void;
}
