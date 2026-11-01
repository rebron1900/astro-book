// Strava 活动数据类型（与 src/data/strava.json 字段对齐）
// 数据源：running_page 同步的 activities.json
export interface StravaActivity {
    run_id: number;
    name: string;
    distance: number; // 米
    moving_time: string; // "0:31:53"
    type: string;
    subtype?: string;
    start_date: string; // ISO
    start_date_local: string; // "2024-03-12 07:05:55"
    location_country?: string;
    summary_polyline?: string;
    average_heartrate?: number | null;
    average_speed?: number;
    elevation_gain?: number;
    streak?: number;
}