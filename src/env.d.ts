/// <reference path="../.astro/types.d.ts" />

declare module 'supercluster' {
    const Supercluster: new (options?: Record<string, unknown>) => {
        load(points: unknown[]): void;
        getClusters(bbox: number[], zoom: number): unknown[];
        getLeaves(clusterId: number, limit?: number): unknown[];
    };
    export default Supercluster;
}

declare module '@mapbox/geojson-extent/geojson-extent' {
    const geojsonExtent: (geojson: unknown) => number[];
    export default geojsonExtent;
}

declare module 'html-parse-stringify' {
    interface AstNode {
        type?: string;
        content?: string;
        name?: string;
        children?: AstNode[];
    }
    const HTML: {
        parse(html: string): AstNode[];
        stringify(ast: AstNode[]): string;
    };
    export default HTML;
}

interface ImportMetaEnv {
    readonly GHOST_API_URL: string;
    readonly GHOST_API_KEY: string;
    readonly GHOST_API_POST_LIMIT: number;
    readonly NEODB_URL: string;
    readonly FLUX_URL: string;
    readonly FLUX_KEY: string;
    readonly CDN_URL: string;
    readonly MAP_URL: string;
    readonly MAP_KEY: string;
    readonly SITE: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
