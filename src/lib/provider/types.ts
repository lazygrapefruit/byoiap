import type { IndexedItem } from '$lib/indexer/types';
import type { MediaId, SeriesId } from '$lib/media-id';
import { Type, type Static, type TObject } from '@sinclair/typebox';

export interface BaseProviderConfig {
    readonly id: string;
}

const DownloadSourceUsenet = Type.Object({
    kind: Type.Literal("usenet"),
    url: Type.Readonly(Type.String()),
    password: Type.ReadonlyOptional(Type.String()),
    fileName: Type.Optional(Type.String()),
    mediaId: Type.Readonly(Type.String()),
    pendingPayload: Type.Optional(Type.String()),
    title: Type.Readonly(Type.String()),
    guid: Type.Readonly(Type.String()),
});

export const DownloadSource = Type.Union([DownloadSourceUsenet]);
export type DownloadSource = Static<typeof DownloadSource>;

export enum ResolveStatus {
    Succeeded,
    Failed,
    Pending,
    LimitReached,
    UnknownFailure,
}

export type ResolveResult = 
    | { status: ResolveStatus.Succeeded, url: string }
    | { status: ResolveStatus.Pending, payload?: string }
    | { status: ResolveStatus.Failed }
    | { status: ResolveStatus.LimitReached }
    | { status: ResolveStatus.UnknownFailure }
;

export interface Provider<Config extends BaseProviderConfig = BaseProviderConfig> {
    readonly id: string;
    readonly configSchema: TObject;

    buildCacheChecker(config: Config, mediaId: MediaId | SeriesId): (items: IndexedItem[], mediaId: MediaId) => Promise<IndexedItem[]>;
    precache(config: Config, source: DownloadSource): Promise<void>;
    resolve(config: Config, source: DownloadSource): Promise<ResolveResult>;
}