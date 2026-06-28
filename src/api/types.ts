export interface DataSource<T = unknown> {
    name: string;
    fetch(): Promise<T>;
    transform?(raw: unknown): T;
}
