import { type MediaId } from "$lib/media-id";
import { Type, type Static, type TObject } from '@sinclair/typebox';

export interface BaseIndexerConfig {
    readonly id: string;
}

export const IndexedItem = Type.Object({
    // The indexer is expected to produce these properties
    grabs: Type.Readonly(Type.Integer()),
    languagesAudio: Type.Readonly(Type.Array(Type.String())),
    languagesSubtitles: Type.Readonly(Type.Array(Type.String())),
    password: Type.ReadonlyOptional(Type.String()),
    publishDate: Type.Readonly(Type.Date()),
    title: Type.Readonly(Type.String()),
    url: Type.Readonly(Type.String()),
    votesUp: Type.Readonly(Type.Integer()),
    votesDown: Type.Readonly(Type.Integer()),

    // These properties aren't expected to be produced by the
    // indexer, but may be optionally added by other systems.
    expectedQuality: Type.Optional(Type.Number()),
    size: Type.Optional(Type.Number()),
    openSubtitlesHash: Type.Optional(Type.String()),
    fileName: Type.Optional(Type.String()),
    mimetype: Type.Optional(Type.String()),
});

export type IndexedItem = Static<typeof IndexedItem>;

export interface Indexer<Config extends BaseIndexerConfig = BaseIndexerConfig> {
    readonly id: string;
    readonly configSchema: TObject;

    query(config: Config, mediaId: MediaId): Promise<IndexedItem[]>;
}