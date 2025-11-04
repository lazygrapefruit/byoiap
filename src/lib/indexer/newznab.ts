import { getSeriesData } from "$lib/media-id";
import { IndexedItem, type Indexer } from "./types";
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import sax from "sax";
import { Readable } from "node:stream";
import assert from "node:assert";
import type { SetOptional, Writable } from "type-fest";
import { countryCodeToLanguageCode, languageNameToCode } from "$lib/language-conversion";
import { getExpectedEpisode } from "$lib/title-utils";

const ID = "newznab";

const NewznabConfig = Type.Object({
    id: Type.Readonly(Type.Literal(ID, {
        title: "Newznab",
        description: "Indexer that supports a Newznab-compatible API.",
        default: ID,
    })),
    url: Type.Readonly(Type.String({
        title: "URL",
        description: "URL to API. Including /api if required.",
    })),
    apiKey: Type.Readonly(Type.String({
        title: "API key",
        description: "Key for API. Will be embedded in requests using apikey=<key>."
    })),
});
export type NewznabConfig = Static<typeof NewznabConfig>;

function parseDate(date: string | number) {
    if (typeof date === "number")
        return new Date(date * 1000); // Convert seconds to milliseconds
    return new Date(date);
}

function attrValue(data: string | sax.QualifiedAttribute | undefined) {
    if (typeof data === "string")
        return data;
    return data?.value;
}

const ATTRIBUTE_HANDLER = Symbol("onattribute");
const CLOSE_TAG_HANDLER = Symbol("onclosetag");
const OPEN_TAG_HANDLER = Symbol("onopentag");
const OPEN_TAG_START_HANDLER = Symbol("onopentagstart");
const TEXT_HANDLER = Symbol("ontext");

type XmlParserEntryHandler<T, U extends `on${string}` & keyof sax.SAXParser> = (state: T, value: Parameters<sax.SAXParser[U]>[0]) => void;

interface XmlParserNode<T> {
    readonly [ATTRIBUTE_HANDLER]?: 
        | XmlParserEntryHandler<T, "onattribute">
        | Record<string, XmlParserEntryHandler<T, "onattribute">>;
    readonly [CLOSE_TAG_HANDLER]?: XmlParserEntryHandler<T, "onclosetag">;
    readonly [OPEN_TAG_HANDLER]?: XmlParserEntryHandler<T, "onopentag">;
    readonly [OPEN_TAG_START_HANDLER]?: XmlParserEntryHandler<T, "onopentagstart">;
    readonly [TEXT_HANDLER]?: XmlParserEntryHandler<T, "ontext">;
    readonly [key: string]: XmlParserNode<T>;
}

interface CapsParseData {
    tryFinish?: () => void;
    readonly data: {
        limit?: number;
        movie?: string[] | undefined;
        tv?: string[] | undefined;
    };
};

function makeSearchingCaps(key: "movie" | "tv") {
    return {
        [ATTRIBUTE_HANDLER]: (
            state: CapsParseData,
            { name, value }: Parameters<sax.SAXParser["onattribute"]>[0]
        ) => {
            if (name !== "supportedParams") return;
            state.data[key] = value.split(",");
            state.tryFinish?.();
        }
    }; 
}

const CAPS_PARSER: XmlParserNode<CapsParseData> = {
    caps: {
        limits: {
            [ATTRIBUTE_HANDLER]: {
                max: (state, { value }) => {
                    state.data.limit = Number.parseInt(value);
                    state.tryFinish?.();
                },
            },
        },
        searching: {
            'movie': makeSearchingCaps("movie"),
            'movie-search': makeSearchingCaps("movie"),
            'moviesearch': makeSearchingCaps("movie"),
            'tv': makeSearchingCaps("tv"),
            'tv-search': makeSearchingCaps("tv"),
            'tvsearch': makeSearchingCaps("tv"),
        },
    },
};

function processXml<T>(
    saxStream: sax.SAXStream,
    parser: XmlParserNode<T>,
    state: T
) {
    let capturedResolve: () => void;
    let capturedReject: (err: unknown) => void;
    return Object.assign(new Promise<void>((resolve, reject) => {
        capturedResolve = resolve;
        capturedReject = reject;
        const nodeStack: (typeof parser | undefined)[] = [parser];

        saxStream.on("attribute", (attribute) => {
            const top = nodeStack[nodeStack.length - 1];
            const handler = top?.[ATTRIBUTE_HANDLER];
            if (!handler) return;
            if (typeof handler === "function")
                handler(state, attribute);
            else
                handler[attribute.name]?.(state, attribute);
        });
        saxStream.on("closetag", (name) => {
            const top = nodeStack[nodeStack.length - 1];
            top?.[CLOSE_TAG_HANDLER]?.(state, name);
            nodeStack.pop();
        });
        saxStream.on("opentag", (tag) => {
            const top = nodeStack[nodeStack.length - 1];
            top?.[OPEN_TAG_HANDLER]?.(state, tag);
        });
        saxStream.on("opentagstart", (tag) => {
            const top = nodeStack[nodeStack.length - 1];
            const toPush = top?.[tag.name];
            nodeStack.push(toPush);
            toPush?.[OPEN_TAG_START_HANDLER]?.(state, tag);
        });
        saxStream.on("text", (text) => {
            const top = nodeStack[nodeStack.length - 1];
            top?.[TEXT_HANDLER]?.(state, text);
        });

        saxStream.on("end", resolve);
        saxStream.on("error", reject);
    }), {
        resolve: capturedResolve!,
        reject: capturedReject!,
    });
}

// There may be some value in caching the caps for a little while, but not doing that right away.
async function getCaps(config: NewznabConfig) {
    const url = new URL(config.url);
    url.searchParams.set("apikey", config.apiKey);
    url.searchParams.set("o", "xml");
    url.searchParams.set("t", "caps");
    const responsePromise = fetch(url);

    const saxStream = sax.createStream(true);
    const parseState: CapsParseData = {
        data: {},
    };
    const processing = processXml(saxStream, CAPS_PARSER, parseState);

    const response = await responsePromise;
    if (response.body) {
        // @ts-expect-error (https://stackoverflow.com/a/66629140)
        const streamReadable = Readable.fromWeb(response.body);
        parseState.tryFinish = () => {
            if ("limit" in parseState.data && "movie" in parseState.data && "tv" in parseState.data) {
                processing.resolve();
                streamReadable.destroy();
            }
        };
        streamReadable.pipe(saxStream);
        await processing;
    }

    return parseState.data;
}

type BuildingIndexItem = SetOptional<Writable<IndexedItem>, "guid" | "url" | "publishDate" | "title"> & {
    season?: number;
    episode?: number;
    indexerHost?: string;
};

interface QueryParseDataInput {
    readonly season?: number;
    readonly episode?: number;
    readonly onTotalItems?: (count: number) => void;
}

interface QueryParseData extends QueryParseDataInput {
    // Output.
    readonly items: IndexedItem[];
    readonly promises: Promise<unknown>[];
    processedItemCount: number;

    // Internal state
    activeItem?: BuildingIndexItem;
}

function processItem(state: QueryParseData, item: BuildingIndexItem) {
    // Filter out items that shouldn't be present due to non-matching metadata
    if (state.season !== undefined || state.episode !== undefined) {
        // Update season and episode from title, if useful.
        if (item.season === undefined || item.episode === undefined) {
            const expected = getExpectedEpisode(item.title!);
            if (expected) {
                item.season ??= expected.season;
                item.episode ??= expected.episode;
            }
        }

        // Filter out episodes that contain non-matching episode data
        if (item.season !== undefined && state.season !== item.season)
            return;
        if (item.episode !== undefined && state.episode !== item.episode)
            return;

        // In my experience seasons without episodes are not well-suited to
        // being part of the results because there is not a consistent way to
        // identify if the episode is present within or which file it would be
        // if it is present.
        if (item.season !== undefined && item.episode === undefined)
            return;
    }

    // De-duplicate languages
    item.languagesAudio = [...new Set(item.languagesAudio)];
    item.languagesSubtitles = [...new Set(item.languagesSubtitles)];

    const toPush = Value.Parse(IndexedItem, item) as Writable<IndexedItem>;
    state.items.push(toPush);

    // Unwrap URLs pointing to the TorBox search API because redirect links to
    // them, such as may come through NZBHydra2, are not as useful. The redirect
    // links do not behave as nicely with TorBox's cache because it uses the
    // passed-in link for generating the cache key.
    if (item.indexerHost === "search-api.torbox.app") {
        state.promises.push(fetch(toPush.url, {
            method: "HEAD",
            redirect: "manual",
        }).then((response) => {
            const location = response.headers.get("location");
            if (location)
                toPush.url = location;
        }));
    }
}

// I've encountered languages in a few different formats. The ones I've
// seen so far are the language, like English or Spanish, and country
// codes, like US or MX.
function mapLanguageToCode(str: string) {
    let code = languageNameToCode(str);
    if (code?.length === 2) return code;
    code = countryCodeToLanguageCode(str);
    if (code?.length === 2) return code;
    return str;
}

function extractLanguages(str: string) {
    const matches = str.match(/\w+/g);
    if (!matches) return [];
    return matches.map(mapLanguageToCode);
}

const firstNumberExtractRegex = /\d+/;
function extractSeasonOrEpisodeNumber(str: string) {
    const firstNumber = firstNumberExtractRegex.exec(str);
    if (!firstNumber) return undefined;
    const result = Number.parseInt(firstNumber[0], 10);
    return Number.isSafeInteger(result) ? result : undefined;
}

type AttrHandler = (target: Required<QueryParseData>["activeItem"], value: string) => void;

const CORE_ATTR_HANDLERS: Record<string, AttrHandler> = {
    grabs: (target, value) => target.grabs = Number.parseInt(value),
    guid: (target, value) => target.guid = value,
    episode: (target, value) => target.episode = extractSeasonOrEpisodeNumber(value),
    language: (target, value) => target.languagesAudio.push(...extractLanguages(value)),
    password: (target, value) => target.password = value,
    season: (target, value) => target.season = extractSeasonOrEpisodeNumber(value),
    subs: (target, value) => target.languagesSubtitles.push(...extractLanguages(value)),
    thumbsup: (target, value) => target.votesUp = Number.parseInt(value),
    thumbsdown: (target, value) => target.votesDown = Number.parseInt(value),
};

const EXTENDED_ATTR_HANDLERS: Record<string, AttrHandler> = {
    hydraIndexerHost: (target, value) => target.indexerHost = value,
};

const ATTR_HANDLERS = {
    ...CORE_ATTR_HANDLERS,
    ...EXTENDED_ATTR_HANDLERS,
};

const DESIRED_ATTRIBUTES = Object.keys(CORE_ATTR_HANDLERS).join(",");

const QUERY_PARSER: XmlParserNode<QueryParseData> = {
    rss: {
        channel: {
            'newznab:response': {
                [ATTRIBUTE_HANDLER]: (state, { name, value }) => {
                    if (name !== "total") return;
                    state.onTotalItems?.(Number.parseInt(value));
                },
            },
            item: {
                [CLOSE_TAG_HANDLER]: (state) => {
                    const { activeItem } = state;
                    assert(activeItem);
                    state.activeItem = undefined;
                    state.processedItemCount += 1;
                    processItem(state, activeItem);
                },
                [OPEN_TAG_HANDLER]: (state) => {
                    assert(!state.activeItem);
                    state.activeItem = {
                        languagesAudio: [],
                        languagesSubtitles: [],
                    };
                },
                enclosure: {
                    [ATTRIBUTE_HANDLER]: {
                        url: (state, { value }) => state.activeItem!.url = value,
                        length: (state, { value }) => state.activeItem!.size = Number.parseInt(value),
                    },
                },
                episode: {
                    [TEXT_HANDLER]: (state, text) => state.activeItem!.episode = Number.parseInt(text),
                },
                guid: {
                    // Prefers attribute, but will use this if needed.
                    [TEXT_HANDLER]: (state, text) => state.activeItem!.guid ??= text,
                },
                language: {
                    [TEXT_HANDLER]: (state, text) => state.activeItem!.languagesAudio.push(...extractLanguages(text)),
                },
                pubDate: {
                    [TEXT_HANDLER]: (state, text) => state.activeItem!.publishDate = parseDate(text),
                },
                season: {
                    [TEXT_HANDLER]: (state, text) => state.activeItem!.season = Number.parseInt(text),
                },
                title: {
                    [TEXT_HANDLER]: (state, text) => state.activeItem!.title = text,
                },
                'newznab:attr': {
                    [OPEN_TAG_HANDLER]: (state, tag) => {
                        const name = attrValue(tag.attributes.name);
                        const value = attrValue(tag.attributes.value);
                        assert(name && value);
                        ATTR_HANDLERS[name]?.(state.activeItem!, value);
                    },
                },
            },
        },
    },
};

const querySegment = async (url: URL, parseState: QueryParseData, offset: number) => {
    url.searchParams.set("offset", `${offset}`);

    const response = await fetch(url);
    const saxStream = sax.createStream(true);

    const processing = processXml(saxStream, QUERY_PARSER, parseState);

    if (response.body) {
        // @ts-expect-error (https://stackoverflow.com/a/66629140)
        Readable.fromWeb(response.body).pipe(saxStream);
        await processing;
    }
};

export const newznabIndexer = {
    id: ID,
    configSchema: NewznabConfig,

    query: async (indexerOptions, mediaId) => {
        Value.Assert(NewznabConfig, indexerOptions);
        const capsPromise = getCaps(indexerOptions);

        let queryParseInput: Writable<QueryParseDataInput> = {};

        const url = new URL(indexerOptions.url);
        url.searchParams.set("apikey", indexerOptions.apiKey);
        url.searchParams.set("o", "xml");
        url.searchParams.set("attrs", DESIRED_ATTRIBUTES);
        //url.searchParams.set("extended", "1");

        let capsKey: keyof Awaited<typeof capsPromise>;
        let searchIds: PotentialSearchIds = {
            imdbid: mediaId.imdbId,
        };
        if (mediaId.kind === "episode") {
            const seriesDataPromise = getSeriesData(mediaId.imdbId);

            capsKey = "tv";
            url.searchParams.set("t", "tvsearch");
            url.searchParams.set("season", String(mediaId.season));
            url.searchParams.set("ep", String(mediaId.episode));

            queryParseInput.season = mediaId.season;
            queryParseInput.episode = mediaId.episode;

            // If the indexer already supports imdbid setting the others is not
            // usually necessary. This makes the queries a little bit faster
            // because fetching the show ids can take some time. In my testing this
            // is capable of saving 2-3 seconds.
            if (!(await capsPromise).tv?.includes("imdbid")) {
                const seriesData = await seriesDataPromise;
                searchIds.rid = seriesData.tvRageId;
                searchIds.tvdbid = seriesData.tvdbId;
                searchIds.tvmazeid = seriesData.tvMazeId;
            }
        }
        else if (mediaId.kind === "movie") {
            capsKey = "movie";
            url.searchParams.set("t", "movie");
        }
        else {
            throw new Error("Invalid media id");
        }

        const searchCaps = (await capsPromise)[capsKey];
        const inserted = insertSearchIds(url.searchParams, searchCaps, searchIds);
        if (!inserted)
            return [];

        const limit = (await capsPromise).limit ?? 50;
        url.searchParams.set("limit", `${limit}`);

        const output = {
            items: new Array<IndexedItem>(),
            promises: new Array<Promise<void>>(),
        };

        // This makes it so we can get all the segments.
        let followupSegments: Promise<void>[] = [];

        // First just start querying with an offset of 0
        const queryData: QueryParseData = {
            ...queryParseInput,
            ...output,
            onTotalItems: (totalCount) => {
                for (let offset = limit; offset < totalCount; offset += limit) {
                    followupSegments.push(querySegment(url, {
                        ...queryParseInput,
                        ...output,
                        processedItemCount: 0,
                    }, offset));
                }
            },
            processedItemCount: 0,
        };
        await querySegment(url, queryData, 0);

        // The other queries should have been started by now, so they can now be awaited here.
        await Promise.all(followupSegments);

        // The output may have some blocking promises on cleaning up data.
        await Promise.all(output.promises);

        return output.items;
    },
} as const satisfies Indexer<NewznabConfig>;

const POTENTIAL_SEARCH_IDS = ["imdbid", "rid", "tvdbid", "tvmazeid"] as const;
type PotentialSearchIds = Partial<Record<typeof POTENTIAL_SEARCH_IDS[number], string | number>>;

function insertSearchIds(searchParams: URLSearchParams, supportedParams: string[] | undefined, ids: PotentialSearchIds) {
    if (!supportedParams) return 0;

    let numInserted = 0;
    for (const idKey of POTENTIAL_SEARCH_IDS) {
        const id = ids[idKey];
        if (!id || !supportedParams.includes(idKey)) continue;
        searchParams.append(idKey, `${id}`);
        ++numInserted;
    }
    return numInserted;
}