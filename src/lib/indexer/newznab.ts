import { getShowData, MovieId, ShowId } from "$lib/media-id";
import { IndexedItem, type Indexer } from "./types";
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import sax from "sax";
import { Readable } from "node:stream";
import assert from "node:assert";
import type { SetOptional, Writable } from "type-fest";
import { languageNameToCode } from "$lib/language-name-to-code";
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

interface XmlParserNode<T> {
    readonly [ATTRIBUTE_HANDLER]?: (state: T, name: Parameters<sax.SAXParser["onattribute"]>[0]) => void;
    readonly [CLOSE_TAG_HANDLER]?: (state: T, name: Parameters<sax.SAXParser["onclosetag"]>[0]) => void;
    readonly [OPEN_TAG_HANDLER]?: (state: T, tag: Parameters<sax.SAXParser["onopentag"]>[0]) => void;
    readonly [OPEN_TAG_START_HANDLER]?: (state: T, tag: Parameters<sax.SAXParser["onopentagstart"]>[0]) => void;
    readonly [TEXT_HANDLER]?: (state: T, tag: Parameters<sax.SAXParser["ontext"]>[0]) => void;
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
            [ATTRIBUTE_HANDLER]: (state, { name, value }) => {
                if (name !== "max") return;
                state.data.limit = Number.parseInt(value);
                state.tryFinish?.();
            }
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
            top?.[ATTRIBUTE_HANDLER]?.(state, attribute);
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

function mapLanguageToCode(input: string) {
    const code = languageNameToCode(input);
    if (code?.length === 2) return code;
    return input;
}

type BuildingIndexItem = SetOptional<Writable<IndexedItem>, "guid" | "url" | "publishDate" | "title"> & {
    season?: number;
    episode?: number;
};

interface QueryParseDataInput {
    readonly season?: number;
    readonly episode?: number;
    readonly onTotalItems?: (count: number) => void;
}

interface QueryParseData extends QueryParseDataInput {
    // Output.
    readonly items: IndexedItem[];
    processedItemCount: number;

    // Internal state
    activeItem?: BuildingIndexItem;
}

const ATTRIBUTE_HANDLERS: Record<string, (target: Required<QueryParseData>["activeItem"], value: string) => void> = {
    grabs: (target, value) => target.grabs = Number.parseInt(value),
    episode: (target, value) => target.episode = Number.parseInt(value),
    language: (target, value) => target.languagesAudio.push(...value.split(" - ").map(mapLanguageToCode)),
    password: (target, value) => target.password = value,
    season: (target, value) => target.season = Number.parseInt(value),
    subs: (target, value) => target.languagesSubtitles.push(...value.split(" - ").map(mapLanguageToCode)),
    thumbsup: (target, value) => target.votesUp = Number.parseInt(value),
    thumbsdown: (target, value) => target.votesDown = Number.parseInt(value),
};

const DESIRED_ATTRIBUTES = Object.keys(ATTRIBUTE_HANDLERS).join(",");

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

                    const toPush = Value.Parse(IndexedItem, activeItem);

                    if (state.season !== undefined || state.episode !== undefined) {
                        // Update season and episode from title, if useful.
                        if (activeItem.season === undefined || activeItem.episode === undefined) {
                            const expected = getExpectedEpisode(toPush.title);
                            if (expected) {
                                activeItem.season ??= expected.season;
                                activeItem.episode ??= expected.episode;
                            }
                        }

                        // Filter out episodes that contain non-matching episode data
                        if (activeItem.season !== undefined && state.season !== activeItem.season)
                            return;
                        if (activeItem.episode !== undefined && state.episode !== activeItem.episode)
                            return;
                    }

                    state.items.push(toPush);
                },
                [OPEN_TAG_HANDLER]: (state) => {
                    assert(!state.activeItem);
                    state.activeItem = {
                        languagesAudio: [],
                        languagesSubtitles: [],
                    };
                },
                guid: {
                    [TEXT_HANDLER]: (state, text) => state.activeItem!.guid = text,
                },
                enclosure: {
                    [ATTRIBUTE_HANDLER]: (state, { name, value }) => {
                        switch (name) {
                            case "url":
                                state.activeItem!.url = value;
                                break;
                            case "length":
                                state.activeItem!.size = Number.parseInt(value);
                                break;
                        }
                    },
                },
                episode: {
                    [TEXT_HANDLER]: (state, text) => state.activeItem!.episode = Number.parseInt(text),
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
                        ATTRIBUTE_HANDLERS[name]?.(state.activeItem!, value);
                    },
                },
            },
        },
    },
};

const querySegment = async (url: URL, parseState: QueryParseData, offset: number) => {
    url.searchParams.set("offset", `${offset}`);

    console.log(url);
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
        url.searchParams.set("extended", "1");

        let capsKey: keyof Awaited<typeof capsPromise>;
        let searchIds: PotentialSearchIds = {
            imdbid: mediaId.imdbId,
        };
        if (mediaId instanceof ShowId) {
            capsKey = "tv";
            url.searchParams.set("t", "tvsearch");
            url.searchParams.set("season", String(mediaId.season));
            url.searchParams.set("ep", String(mediaId.episode));
            const showData = await getShowData(mediaId.imdbId);

            queryParseInput.season = mediaId.season;
            queryParseInput.episode = mediaId.episode;

            searchIds.rid = showData.tvRageId;
            searchIds.tvdbid = showData.tvdbId;
            searchIds.tvmazeid = showData.tvMazeId;
        }
        else if (mediaId instanceof MovieId) {
            capsKey = "movie";
            url.searchParams.set("t", "movie");
        }
        else {
            throw new Error("Invalid media id");
        }

        const searchCaps = (await capsPromise)[capsKey];
        const inserted = insertSearchIds(url.searchParams, searchCaps, searchIds);
        console.log(await capsPromise);
        if (!inserted)
            return [];

        const limit = (await capsPromise).limit ?? 50;
        url.searchParams.set("limit", `${limit}`);

        const result: IndexedItem[] = [];

        // This makes it so we can get all the segments.
        let followupSegments: Promise<void>[] = [];

        // First just start querying with an offset of 0
        const queryData: QueryParseData = {
            ...queryParseInput,
            onTotalItems: (totalCount) => {
                for (let offset = limit; offset < totalCount; offset += limit)
                    followupSegments.push(querySegment(url, { ...queryParseInput, items: result, processedItemCount: 0 }, offset));
            },
            items: result,
            processedItemCount: 0,
        };
        await querySegment(url, queryData, 0);

        // The other queries should have been started by now, so they can now be awaited here.
        await Promise.all(followupSegments);

        return result;
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