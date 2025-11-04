import { type MediaId } from "$lib/media-id";
import { DownloadSource } from "$lib/provider/types";
import { Type, type Static, type TObject } from '@sinclair/typebox';

export interface BaseIndexerConfig {
    readonly id: string;
}

export const IndexedItem = Type.Intersect([
    Type.Omit(DownloadSource, ["kind", "mediaId"]),
    Type.Object({
        // The indexer is expected to produce these properties
        grabs: Type.ReadonlyOptional(Type.Integer()),
        languagesAudio: Type.Readonly(Type.Array(Type.String())),       // Expected to be 2 letter codes
        languagesSubtitles: Type.Readonly(Type.Array(Type.String())),   // Expected to be 2 letter codes
        publishDate: Type.Readonly(Type.Date()),
        votesUp: Type.ReadonlyOptional(Type.Integer()),
        votesDown: Type.ReadonlyOptional(Type.Integer()),

        // These properties aren't expected to be produced by the
        // indexer, but may be optionally added by other systems.
        expectedQuality: Type.Optional(Type.Number()),
        mimetype: Type.Optional(Type.String()),
        openSubtitlesHash: Type.Optional(Type.String()),
        size: Type.Optional(Type.Number()),
        status: Type.Optional(Type.Union([
            Type.Literal("cached"),
            Type.Literal("ready"),
            Type.Literal("downloading"),
            Type.Literal("failed"),
        ])),
    }),
]);

export type IndexedItem = Static<typeof IndexedItem>;

export interface Indexer<Config extends BaseIndexerConfig = BaseIndexerConfig> {
    readonly id: string;
    readonly configSchema: TObject;

    query(config: Config, mediaId: MediaId): Promise<IndexedItem[]>;
}