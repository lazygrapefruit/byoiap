import { Type, type Static } from '@sinclair/typebox';
import { IndexerConfig } from "$lib/indexer";
import { ProviderConfig } from "$lib/provider";

export const AddonConfig = Type.Object({
    indexer: IndexerConfig,
    provider: ProviderConfig,
    shared: Type.Object({
        id: Type.Readonly(Type.Literal("shared", {
            title: "Shared",
            default: "shared",
        })),
        nextEpisodeCacheCount: Type.Readonly(Type.Number({
            title: "Next Episode Cache Count",
            description: "The number of episodes to attempt to cache when starting a video",
            minimum: 0,
            maximum: 10,
            default: 1,
            multipleOf: 1,
        })),
        pendingRetrySeconds: Type.Readonly(Type.Number({
            title: "Pending Retry Seconds",
            description: "How long to poll retry while download is pending. Prevents show failure videos.",
            minimum: 0,
            maximum: 600,
            default: 180,
            multipleOf: 1,
        })),
        preferredQualities: Type.Readonly(Type.Array(Type.Number(), {
            title: "Preferred Quality",
            description: 'Qualities ordered by preference. Use numbers such as 1080 to mean 1080p',
            default: [],
            maxItems: 10,
        })),
        preferredAudioLanguages: Type.Readonly(Type.Array(Type.String(), {
            title: "Preferred Audio Languages",
            description: 'Audio languages ordered by preference. Use short codes, such as "en" for "English"',
            default: ["en"],
            maxItems: 10,
        })),
        preferredSubtitleLanguages: Type.Readonly(Type.Array(Type.String(), {
            title: "Preferred Subtitle Languages",
            description: 'Subtitle languages ordered by preference. Use short codes, such as "en" for "English"',
            default: ["en"],
            maxItems: 10,
        })),
    }),
});
export type AddonConfig = Static<typeof AddonConfig>;