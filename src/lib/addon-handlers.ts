import { fallbackLangFlag } from "language-emoji";
import type { AddonConfig } from "./config";
import { ALL_INDEXERS } from "./indexer";
import type { IndexedItem } from "./indexer/types";
import { makeMediaId } from "./media-id";
import { ALL_PROVIDERS } from "./provider";
import { displaySort } from "./title-utils";
import { DownloadSource } from "./provider/types";
import prettyBytes from "pretty-bytes";
import { capitalCase } from "change-case";

export const INJECTED_CONFIG_KEY = Symbol("InjectedConfig");

export interface HandlerConfig extends AddonConfig {
    readonly [INJECTED_CONFIG_KEY]: {
        readonly configStr: string;
        readonly origin: string;
    };
}

interface StreamHandlerArgs {
    readonly type: string;
    readonly id: string;
    readonly extra?: unknown;
    readonly config: HandlerConfig;
}

const MINIMUM_PER_QUALITY = 5;
const MAXIMUM_PER_QUALITY = 20;

function isBad(item: IndexedItem) {
    return (item.votesDown ?? 0) > (item.votesUp ?? 0);
}

function daysSince(date: Date) {
    const now = Date.now();
    
    // Calculate the difference in milliseconds
    const differenceInMilliseconds = now - date.getTime();
    
    // Convert milliseconds to days
    const millisecondsInADay = 1000 * 60 * 60 * 24;
    const daysElapsed = Math.floor(differenceInMilliseconds / millisecondsInADay);
    
    return daysElapsed;
}

function languageCodeToFlag(code: string) {
    return (code && fallbackLangFlag(code)) || '�';
}

function itemToStream(
    config: HandlerConfig,
    item: IndexedItem,
    mediaId: string,
    baseCacheNextUrl: URL | undefined
) {
    const { configStr, origin } = config[INJECTED_CONFIG_KEY];
    const url = new URL(`${configStr}/resolve`, origin);
    url.searchParams.set("kind", "usenet");
    url.searchParams.set("mediaId", mediaId);

    for (const key in DownloadSource.properties) {
        const value = item[key as keyof IndexedItem];
        if (value) url.searchParams.set(key, `${value}`);
    }

    // The next cache URL is the same for every entry except for the title to match. So, if present,
    // just overwrite the title and use that.
    if (baseCacheNextUrl) {
        baseCacheNextUrl.searchParams.set("title", item.title);
        url.searchParams.set("asyncChain", `${baseCacheNextUrl}`);
    }

    let title = `${item.title}`;
    title += `\nAudio: ${(item.languagesAudio).map(languageCodeToFlag)}`;
    title += `\nSubtitles: ${(item.languagesSubtitles).map(languageCodeToFlag)}`;
    title += `\nAge: ${daysSince(item.publishDate)}`;
    if (typeof item.grabs === "number")
        title += ` | Grabs: ${item.grabs}`;
    if (typeof item.size === "number")
        title += ` | Size: ${prettyBytes(item.size)}`;
    if (typeof item.votesUp === "number" || typeof item.votesDown === "number")
        title += ` | Votes: ${item.votesUp ?? 0}-${item.votesDown ?? 0}`;

    const quality = item.expectedQuality ?? "Unknown";
    let name = `byoiap\n${quality}`;
    if (item.status)
        name += `\n[${capitalCase(item.status)}]`;

    // https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md
    const result = {
        url: url.toString(),
        name,
        title,
        behaviorHints: {
            bingeGroup: `byoiap-${quality}`,
            filename: item.fileName,
            notWebReady: item.mimetype ? item.mimetype !== "video/mp4" : undefined,
            videoHash: item.openSubtitlesHash,
            videoSize: item.size,
        },
    };

    return result;
}

export async function streamHandler(args: StreamHandlerArgs): Promise<{ streams: (ReturnType<typeof itemToStream>)[] }> {
    // console.log(`request for streams: `, args);
    const startTime = performance.now();
    const { config, id } = args;

    const mediaId = makeMediaId(id);

    const indexer = ALL_INDEXERS.get(config.indexer.id);
    const provider = ALL_PROVIDERS.get(config.provider.id);
    if (!indexer || !provider || !mediaId)
        return { streams: [] };

    // The cache checker is built prior to starting the query because it may start promises
    // that get used later. This allows them to resolve while the query is in flight.
    const cacheChecker = provider.buildCacheChecker(config.provider, mediaId);
    const indexedItems = await indexer.query(config.indexer, mediaId);

    // Send out provider cache check as soon as possible. Ideally there is other work we can do while
    // waiting on it.
    const cached = cacheChecker(indexedItems, mediaId);

    let baseCacheNextUrl: URL | undefined;
    if (mediaId.kind === "episode" && config.shared.nextEpisodeCacheCount > 0) {
        baseCacheNextUrl = new URL(
            `${config[INJECTED_CONFIG_KEY].configStr}/cachenext/${encodeURIComponent(id)}`, 
            config[INJECTED_CONFIG_KEY].origin
        );
    }

    // Perform an initial sort and calculate the default sort order. The default order makes it easier
    // to insert the streams in the right order when dealing with things like that the cached items
    // go up front.
    displaySort(config, indexedItems);
    const urlToSortOrder: Record<string, number> = Object.create(null);
    indexedItems.forEach((item, index) => {
        urlToSortOrder[item.url] = index;
    });

    const streamGroups: Record<string, (ReturnType<typeof itemToStream>)[]> = {
        ready: [],
        cached: [],
        default: [],
        failed: [],
    };

    await cached; // I'm not directly using the cached items, but need to wait for them to populate any potential statuses
    {
        let currentQuality: number | undefined;
        let foundInQuality = 0;

        for (const item of indexedItems) {
            const stream = itemToStream(config, item, id, baseCacheNextUrl);
            
            let group: keyof typeof streamGroups;
            switch (item.status) {
                case "cached":      group = "cached"; break;
                case "failed":      group = "failed"; break;
                case "ready":       group = "ready";  break;
                default:            group = "default"; break;
            }

            // Only the default group respects quality limits
            if (group === "default") {
                if (currentQuality !== item.expectedQuality) {
                    currentQuality = item.expectedQuality;
                    foundInQuality = 0;
                }

                ++foundInQuality;
                if (foundInQuality > MAXIMUM_PER_QUALITY)
                    continue;

                if (foundInQuality > MINIMUM_PER_QUALITY && isBad(item))
                    continue;
            }

            streamGroups[group].push(stream);
        }
    }

    const streams = [...streamGroups.ready, ...streamGroups.cached, ...streamGroups.default, ...streamGroups.failed];
    console.log(`[streams] Got ${streams.length} streams in ${(performance.now() - startTime).toFixed(0)}ms`);
    return { streams };
}
