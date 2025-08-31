import { DownloadSource, ResolveStatus, type Provider } from "./types";
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { createHash } from "crypto";

const ID = "torbox";
const API_ROOT = "https://api.torbox.app";

const TorboxConfig = Type.Object({
    id: Type.Readonly(Type.Literal(ID, {
        title: "TorBox Provider",
        description: "Provider that uses TorBox's API",
        default: ID,
    })),
    apiKey: Type.Readonly(Type.String({
        title: "API Key",
        description: "Your API Key from https://www.torbox.app/settings"
    })),
    proxyFile: Type.Readonly(Type.Boolean({
        title: "Proxy File",
        description: "When on, BYOIAP downloads the NZB and passes it to TorBox as a file. This both allows localhost indexers, such as NZBHydra2, and prevents passing a URL with your API key to TorBox.",
        default: false,
    })),
});
type TorboxConfig = Static<typeof TorboxConfig>;

const DownloadResult = Type.Union([
    Type.Object({
        success: Type.Literal(true),
        error: Type.Null(),
        data: Type.Object({
            usenetdownload_id: Type.Union([Type.Number(), Type.String()]),
        }),
    }),
    Type.Object({
        success: Type.Literal(false),
        error: Type.Literal("ACTIVE_LIMIT"),
        data: Type.Object({
            active_limit: Type.Number(),
            currenct_active_downloads: Type.Number(),
        }),
    }),
    Type.Object({
        success: Type.Literal(false),
        error: Type.Union([
            Type.Literal("AUTH_ERROR"),
            Type.Literal("DOWNLOAD_SERVER_ERROR"),
            Type.Literal("UNKNOWN_ERROR"),
        ]),
    }),
]);

const ListResult = Type.Object({
    success: Type.Boolean(),
    data: Type.Array(Type.Object({
        id: Type.Integer(),
        active: Type.ReadonlyOptional(Type.Boolean()),
        name: Type.ReadonlyOptional(Type.String()),
        download_present: Type.ReadonlyOptional(Type.Boolean()),
        download_finished: Type.ReadonlyOptional(Type.Boolean()),
        files: Type.Array(Type.Object({
            id: Type.Integer(),
            size: Type.Integer(),
            mimetype: Type.ReadonlyOptional(Type.String()),
            short_name: Type.String(),
            opensubtitles_hash: Type.ReadonlyOptional(Type.String()),
        })),
    })),
});
type ListResult = Static<typeof ListResult>;

type PreQueryPayload = {
    readonly id: number;
    readonly name: string;
    readonly size: number;
    readonly openSubtitlesHash: string | undefined;
    readonly fileName: string;
    readonly mimetype: string | undefined;
}[];

function buildName(title: string, guid: string) {
    const guidHash = createHash("md5").update(guid).digest("base64url");
    return `${title} [${guidHash}]`;
}

async function createDownload(config: TorboxConfig, source: DownloadSource, sync = true) {
    const formData = new FormData();
    if (source.password)
        formData.set("password", source.password);
    formData.set("name", buildName(source.title, source.guid));

    if (config.proxyFile) {
        // TODO: Strip comments from the file. This is because some indexers provide
        // grabs that include comments that include information about the grab request,
        // which fights against the cache.
        const nzbResponse = await fetch(source.url);
        const nzbRaw = await nzbResponse.blob();

        // It seems that TorBox handles mimetypes incorrectly. It does not account for
        // mimetypes with multiple parts, such as charset.
        const nzb = new Blob([nzbRaw], {
            type: nzbRaw.type.split(";")[0],
        });
        formData.set("file", nzb);
    }
    else {
        formData.set("link", source.url);
    }

    const createResponse = await fetch(new URL(`/v1/api/usenet/${sync ? "" : "async"}createusenetdownload`, API_ROOT), {
        method: "POST",
        body: formData,
        headers: {
            Authorization: `Bearer ${config.apiKey}`
        },
    });

    // No reason to spend cycles parsing JSON and such if this was async.
    if (!sync)
        return;

    const text = await createResponse.text();

    let json;
    try {
        json = JSON.parse(text);
    }
    catch (err) {
        console.error(`Failed to parse response with status ${createResponse.status}: ${text} as json`);
        throw err;
    }

    console.log(json);
    return json;
}

async function getMyLibrary(config: TorboxConfig) {
    const LIMIT = 1000;
    const listUrl = new URL("/v1/api/usenet/mylist", API_ROOT);
    listUrl.searchParams.set("limit", `${LIMIT}`);

    const available: PreQueryPayload = [];
    const failed: string[] = [];
    for (let i = 0;; ++i) {
        listUrl.searchParams.set("offset", `${i * LIMIT}`);
        const response = await fetch(listUrl, {
            headers: {
                Authorization: `Bearer ${config.apiKey}`
            },
        });
        const json: ListResult = await response.json();
        Value.Assert(ListResult, json);
        if (!json.success) break;

        for (const item of json.data ?? []) {
            if (!item.name) continue;
            if (!item.download_present || !item.download_finished) {
                if (!item.active) failed.push(item.name);
                continue;
            }
            const file = getPreferredFile(item.files);
            if (!file) continue;
            available.push({
                id: item.id,
                name: item.name,
                openSubtitlesHash: file.opensubtitles_hash,
                fileName: file.short_name,
                mimetype: file.mimetype,
                size: file.size,
            });
        }

        if (json.data.length < LIMIT) break;
    }

    return { available, failed };
}

interface UsenetFile {
    readonly id: number;
    readonly mimetype?: string;
    readonly opensubtitles_hash?: string;
    readonly short_name: string;
    readonly size: number;
}

function getPreferredFile(files: UsenetFile[], fileName?: string | undefined): UsenetFile | undefined {
    if (fileName) {
        for (const file of files) {
            if (file.short_name === fileName)
                return file;
        }
    }
    else {
        for (const file of files) {
            // For now, just assuming that the opensubtitles_hash indicates
            // the media being looked for.
            if (typeof file.opensubtitles_hash === "string")
                return file;
        }
    }
}

export const torboxProvider = {
    id: ID,
    configSchema: TorboxConfig,

    buildCacheChecker: function(config) {
        Value.Assert(TorboxConfig, config);
        const myLibraryPromise = getMyLibrary(config);

        return async (items) => {
            if (items.length < 1) return [];

            const requests: Promise<Response>[] = [];

            const hashToItem = new Map<string, typeof items[0]>();
            for (const item of items)
                hashToItem.set(createHash("md5").update(item.url, "utf-8").digest("hex"), item);

            const listUrl = new URL("/v1/api/usenet/checkcached", API_ROOT);
            listUrl.searchParams.set("format", "list");
            listUrl.searchParams.set("list_files", "true");

            let added = 0;
            let building = "";
            const finalizeRequest = () => {
                listUrl.searchParams.set("hash", building);
                requests.push(fetch(listUrl, {
                    headers: {
                        Authorization: `Bearer ${config.apiKey}`
                    },
                }));
                building = "";
                added = 0;
            };

            const ALLOWED_PER_CHUNK = 50;
            for (const hash of hashToItem.keys()) {
                building += hash;
                ++added;
                if (added >= ALLOWED_PER_CHUNK)
                    finalizeRequest();
                else
                    building += ",";
            }
            if (added)
                finalizeRequest();

            // Build a lookup table of expected names to items so that the this can be used
            // to establish which items are already in the list of my cached items.
            const nameToItem = new Map<string, typeof items[0]>();
            for (const item of items)
                nameToItem.set(buildName(item.title, item.guid), item);

            const result = new Set<typeof items[number]>();
            await Promise.all([
                myLibraryPromise.then(({ available, failed }) => {
                    for (const libraryItem of available) {
                        const item = nameToItem.get(libraryItem.name);
                        if (!item) continue;
                        result.add(item);

                        item.pendingPayload = `${libraryItem.id}`;
                        item.fileName = libraryItem.fileName;
                        item.mimetype = libraryItem.mimetype;
                        item.openSubtitlesHash = libraryItem.openSubtitlesHash;
                        item.size = libraryItem.size;
                    }
                    for (const libraryItem of failed) {
                        const item = nameToItem.get(libraryItem);
                        if (item) item.previouslyFailed = true;
                    }
                }),
                ...requests.map(async (response) => {
                    const json = await (await response).json();
                    if (!json.data) return;
                    for (const { hash, files } of json.data) {
                        const item = hashToItem.get(hash);
                        if (!item) continue;
                        const file = getPreferredFile(files);
                        if (!file) continue;

                        result.add(item);
                        item.fileName = file.short_name;
                        item.mimetype = file.mimetype;
                        item.openSubtitlesHash = file.opensubtitles_hash;
                        item.size = file.size;
                    }
                }),
            ]);

            return [...result];
        };
    },
    precache: function(config, source) {
        Value.Assert(TorboxConfig, config);
        Value.Assert(DownloadSource, source);
        return createDownload(config, source, false);
    },
    resolve: async function(config, source) {
        Value.Assert(TorboxConfig, config);
        Value.Assert(DownloadSource, source);

        let downloadId = source.pendingPayload;
        if (downloadId == null) {
            const createJson = await createDownload(config, source);
            Value.Assert(DownloadResult, createJson);
            switch (createJson.error) {
                case null:
                    downloadId = String(createJson.data.usenetdownload_id);
                    break;
                case "ACTIVE_LIMIT":
                    return { status: ResolveStatus.LimitReached };
                default:
                    return { status: ResolveStatus.UnknownFailure };
            }
        }

        const listUrl = new URL("/v1/api/usenet/mylist", API_ROOT);
        listUrl.searchParams.set("id", downloadId);
        const response = await fetch(listUrl, {
            headers: {
                Authorization: `Bearer ${config.apiKey}`
            },
        });

        const json = await response.json();
        const file = getPreferredFile(json.data.files, source.fileName);
        if (file) {
            const dlUrl = new URL("/v1/api/usenet/requestdl", API_ROOT);
            dlUrl.searchParams.set("token", config.apiKey);
            dlUrl.searchParams.set("usenet_id", json.data.id);
            dlUrl.searchParams.set("file_id", `${file.id}`);
            return {
                status: ResolveStatus.Succeeded,
                url: await fetch(dlUrl).then(r => r.json()).then(j => j.data),
            };
        }

        if (!json.download_finished)
            return { status: ResolveStatus.Pending, payload: downloadId };

        return { status: ResolveStatus.UnknownFailure };
    },
} as const satisfies Provider<TorboxConfig>;