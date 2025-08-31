import { fallbackLangFlag } from "language-emoji";
import type { Config } from "./config";
import { ALL_INDEXERS, IndexerConfig } from "./indexer";
import type { IndexedItem } from "./indexer/types";
import { languageNameToCode } from "./language-name-to-code";
import { MovieId, ShowId, type MediaId } from "./media-id";
import { ALL_PROVIDERS } from "./provider";
import { displayCompare, getExpectedQuality } from "./title-utils";
import { DownloadSource } from "./provider/types";
import prettyBytes from "pretty-bytes";
import { capitalCase } from "change-case";

export const INJECTED_CONFIG_KEY = Symbol("InjectedConfig");

export interface AddonConfig extends Config {
    readonly [INJECTED_CONFIG_KEY]: {
        readonly configStr: string;
        readonly origin: string;
    };
}

interface StreamHandlerArgs {
    readonly type: string;
    readonly id: string;
    readonly extra?: unknown;
    readonly config: AddonConfig;
}

const MINIMUM_PER_QUALITY = 5;
const MAXIMUM_PER_QUALITY = 20;

function isBad(item: IndexedItem) {
    return item.votesDown > item.votesUp;
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

function languageNameToFlag(name: string) {
    const code = languageNameToCode(name);
    return (code && fallbackLangFlag(code)) || '�';
}

function itemToStream(config: AddonConfig, item: IndexedItem, baseCacheNextUrl: URL | undefined) {
    const { configStr, origin } = config[INJECTED_CONFIG_KEY];
    const url = new URL(`${configStr}/resolve`, origin);
    url.searchParams.set("kind", "usenet");

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
    title += `\nAudio: ${(item.languagesAudio).map(languageNameToFlag)}`;
    title += `\nSubtitles: ${(item.languagesSubtitles).map(languageNameToFlag)}`;
    title += `\nAge: ${daysSince(item.publishDate)} | Grabs: ${item.grabs}`;
    if (typeof item.size === "number") title += ` | Size ${prettyBytes(item.size)}`;
    title += ` | Votes: ${item.votesUp}-${item.votesDown}`;

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

export async function streamHandler(args: StreamHandlerArgs) {
    // console.log(`request for streams: `, args);
    const startTime = performance.now();
    const { config, id, type } = args;
    const streams: (ReturnType<typeof itemToStream>)[] = [];

    let mediaId: MediaId;
    if (type === "movie")
        mediaId = new MovieId(id);
    else if (type === "series")
        mediaId = new ShowId(id);
    else
        throw new Error("Invalid media type");

    const indexer = ALL_INDEXERS.get(config.indexer.id);
    const provider = ALL_PROVIDERS.get(config.provider.id);
    if (!indexer || !provider || !mediaId)
        return { streams };

    // The cache checker is built prior to starting the query because it may start promises
    // that get used later. This allows them to resolve while the query is in flight.
    const cacheChecker = provider.buildCacheChecker(config.provider);
    const indexedItems = await indexer.query(config.indexer, mediaId);

    // Send out provider cache check as soon as possible. Ideally there is other work we can do while
    // waiting on it.
    const cached = cacheChecker(indexedItems);

    let baseCacheNextUrl: URL | undefined;
    if (type === "series" && config.shared.nextEpisodeCacheCount > 0) {
        baseCacheNextUrl = new URL(
            `${config[INJECTED_CONFIG_KEY].configStr}/cachenext/${encodeURIComponent(id)}`, 
            config[INJECTED_CONFIG_KEY].origin
        );
    }

    // Insert expected quality
    for (const item of indexedItems)
        item.expectedQuality = getExpectedQuality(item.title);

    // Perform an initial sort and calculate the default sort order. The default order makes it easier
    // to insert the streams in the right order when dealing with things like that the cached items
    // go up front.
    indexedItems.sort(displayCompare);
    const urlToSortOrder: Record<string, number> = Object.create(null);
    indexedItems.forEach((item, index) => {
        urlToSortOrder[item.url] = index;
    });

    // First, insert the cached items.
    const addedUrls = new Set<string>();
    for (const item of (await cached).sort((a, b) => urlToSortOrder[a.url] - urlToSortOrder[b.url])) {
        const stream = itemToStream(config, item, baseCacheNextUrl);
        streams.push(stream);
        addedUrls.add(item.url);
    }

    // Now filter and insert the remainder
    {
        let currentQuality: number | undefined;
        let foundInQuality = 0;

        for (const item of indexedItems) {
            if (addedUrls.has(item.url))
                continue;

            if (currentQuality !== item.expectedQuality) {
                currentQuality = item.expectedQuality;
                foundInQuality = 0;
            }

            ++foundInQuality;
            if (foundInQuality > MAXIMUM_PER_QUALITY)
                continue;

            if (foundInQuality > MINIMUM_PER_QUALITY && isBad(item))
                continue;

            const stream = itemToStream(config, item, baseCacheNextUrl);
            streams.push(stream);
        }
    }

    console.log(`[streams] Got ${streams.length} streams in ${(performance.now() - startTime).toFixed(0)}ms`);
    return { streams };
}
