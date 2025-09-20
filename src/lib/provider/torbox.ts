import { DownloadSource, ResolveStatus, type Provider } from "./types";
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { createHash } from "crypto";

const ID = "torbox";
const API_ROOT = "https://api.torbox.app";
const NZB_MIMETYPE = "application/x-nzb";

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
            usenetdownload_id: Type.Number(),
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
type DownloadResult = Static<typeof DownloadResult>;

const ListResult = Type.Object({
    success: Type.Boolean(),
    data: Type.Array(Type.Object({
        id: Type.Integer(),
        active: Type.ReadonlyOptional(Type.Boolean()),
        name: Type.ReadonlyOptional(Type.String()),
        download_present: Type.ReadonlyOptional(Type.Boolean()),
        files: Type.Array(Type.Object({
            id: Type.Integer(),
            size: Type.Integer(),
            mimetype: Type.ReadonlyOptional(Type.String()),
            short_name: Type.String(),
            opensubtitles_hash: Type.ReadonlyOptional(Type.Union([Type.String(), Type.Null()])),
        })),
    })),
});
type ListResult = Static<typeof ListResult>;

interface PendingPayload {
    downloadId: number | undefined;
    fileId: number | undefined;
}

function serializePendingPayload(data: PendingPayload) {
    return `${data.downloadId ?? ""}_${data.fileId ?? ""}`;
}

function parseOptionalNumber(num: string) {
    const result = Number.parseInt(num);
    if (Number.isInteger(result)) return result;
}

function deserializePendingPayload(data: string | undefined): PendingPayload | undefined {
    if (!data) return undefined;
    const [downloadId, fileId] = data.split("_").map(parseOptionalNumber);
    return {
        downloadId,
        fileId,
    };
}

function buildName(title: string, guid: string) {
    const guidHash = createHash("md5").update(guid).digest("base64url");
    return `${title} [${guidHash}]`;
}

async function* myLibraryItems(config: TorboxConfig) {
    const LIMIT = 1000;
    const listUrl = new URL("/v1/api/usenet/mylist", API_ROOT);
    listUrl.searchParams.set("limit", `${LIMIT}`);

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

        // Here we try to find a name match. If we get one, create a response
        // compatible with a sync request.
        for (const item of json.data ?? [])
            yield item;

        if (json.data.length < LIMIT) break;
    }
}

// Get either the file or link. In the future this will probably have all of the following options:
//  1. Directly send the link the indexer provided.
//  2. Send a proxy link where BYOIAP performs the download.
//  3. Send the file directly
async function getDownloadNzb(config: TorboxConfig, source: DownloadSource): Promise<["file", Blob] | ["link", string]> {
    if (!config.proxyFile)
        return ["link", source.url];

    const nzbResponse = await fetch(source.url);
    
    // Special case for TorBox links. There should be a better way to do this, but this is fine enough for now.
    // This version just currently has the unfortunate behavior that it requires Hydra to be set to redirect.
    if (nzbResponse.status === 403) {
        const responseUrl = new URL(nzbResponse.url);
        if (responseUrl.hostname.endsWith(".torbox.app"))
            return ["link", nzbResponse.url];
    }

    let nzb = await nzbResponse.blob();
    
    // It seems that TorBox fails to account for some mimetypes, such as ones with
    // multiple parts like ones that include charset. So if needed wrap it it with
    // a type that will be accepted
    if (nzb.type !== NZB_MIMETYPE)
        nzb = new Blob([nzb], { type: NZB_MIMETYPE });

    return ["file", nzb];
}

async function createDownload(config: TorboxConfig, source: DownloadSource, sync = true) {
    const name = buildName(source.title, source.guid);

    // Check if this has already been submitted. This is to help prevent duplicate downloads.
    // The reason it works is that the name is based on the guid, so if the name already exists
    // then the item already exists.
    for await (const item of myLibraryItems(config)) {
        if (item.name !== name) continue;
        return {
            success: true,
            error: null,
            data: {
                usenetdownload_id: item.id,
            },
        } satisfies DownloadResult;
    }

    // Build the form request
    const formData = new FormData();
    if (source.password)
        formData.set("password", source.password);
    formData.set("name", name);

    const [nzbKey, nzbValue] = await getDownloadNzb(config, source);
    formData.set(nzbKey, nzbValue);

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

interface LibraryItemBase {
    readonly id: number;
    readonly name: string;
}

interface LibraryItemDone extends LibraryItemBase {
    readonly status: "done";
    readonly files: ListResult["data"][number]["files"];
}

interface LibraryItemFailed extends LibraryItemBase {
    readonly status: "failed";
}

interface LibraryItemDownloading extends LibraryItemBase {
    readonly status: "downloading";
}

type LibraryItem = LibraryItemDone | LibraryItemFailed | LibraryItemDownloading;

async function getMyLibrary(config: TorboxConfig) {
    const libraryItems: LibraryItem[] = [];
    for await (const item of myLibraryItems(config)) {
        if (!item.name) continue;

        const base: LibraryItemBase = {
            id: item.id,
            name: item.name,
        };
        if (!item.download_present) {
            libraryItems.push({ ...base, status: item.active ? "downloading" : "failed" });
            continue;
        }

        libraryItems.push({
            ...base,
            status: "done",
            files: item.files,
        });
    }
    return libraryItems;
}

interface UsenetFile {
    readonly id: number;
    readonly mimetype?: string;
    readonly opensubtitles_hash?: string | null;
    readonly short_name: string;
    readonly size: number;
}

function getPreferredFile(files: UsenetFile[], fileName?: string | undefined): UsenetFile | undefined {
    if (fileName) {
        for (const file of files) {
            if (file.short_name === fileName)
                return file;
        }
        return undefined;
    }

    // Assuming that the largest file is probably the desired file
    let bestFile: UsenetFile | undefined;
    let largestSize = 0;
    for (const file of files) {
        if (file.size <= largestSize) continue;
        largestSize = file.size;
        bestFile = file;
    }
    return bestFile;
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

            // Only bother checking the cache for links if not using the proxyFile setting because
            // with proxyFile on things there won't be downloads by link anyway so all this cache
            // checking would be wasted.
            if (!config.proxyFile) {
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
            }

            // Build a lookup table of expected names to items so that the this can be used
            // to establish which items are already in the list of my cached items.
            const nameToItem = new Map<string, typeof items[0]>();
            for (const item of items)
                nameToItem.set(buildName(item.title, item.guid), item);

            const result = new Set<typeof items[number]>();
            await Promise.all([
                myLibraryPromise.then((libraryItems) => {
                    for (const libraryItem of libraryItems) {
                        const item = nameToItem.get(libraryItem.name);
                        if (!item) continue;
                        item.status = "failed"; // This is expected to be overwritten if valid
                        const pendingPayload: PendingPayload = {
                            downloadId: libraryItem.id,
                            fileId: undefined,
                        };

                        if (libraryItem.status === "done") {
                            const preferredFile = getPreferredFile(libraryItem.files);
                            if (preferredFile) {
                                result.add(item);

                                item.status = "ready";
                                pendingPayload.fileId = preferredFile.id;
                                item.fileName = preferredFile.short_name;
                                item.mimetype = preferredFile.mimetype;
                                item.openSubtitlesHash = preferredFile.opensubtitles_hash ?? undefined;
                                item.size = preferredFile.size;
                            }
                        }
                        else {
                            item.status = libraryItem.status;
                        }

                        item.pendingPayload = serializePendingPayload(pendingPayload);
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
                        item.status = "cached";
                        item.fileName = file.short_name;
                        item.mimetype = file.mimetype;
                        item.openSubtitlesHash = file.opensubtitles_hash ?? undefined;
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
        const pending = deserializePendingPayload(source.pendingPayload);
        let downloadId = pending?.downloadId;
        let fileId = pending?.fileId;

        // Get the download id
        if (typeof downloadId !== "number") {
            const createJson = await createDownload(config, source);
            Value.Assert(DownloadResult, createJson);
            switch (createJson.error) {
                case null:
                    downloadId = createJson.data.usenetdownload_id;
                    break;
                case "ACTIVE_LIMIT":
                    return { status: ResolveStatus.LimitReached };
            }
        }
        if (typeof downloadId !== "number")
            return { status: ResolveStatus.UnknownFailure };

        // Get the file id
        if (typeof fileId !== "number") {
            const listUrl = new URL("/v1/api/usenet/mylist", API_ROOT);
            listUrl.searchParams.set("id", `${downloadId}`);
            const response = await fetch(listUrl, {
                headers: {
                    Authorization: `Bearer ${config.apiKey}`
                },
            });

            const listItemData = (await response.json()).data;
            if (!listItemData.download_present) {
                if (listItemData.active)
                    return { status: ResolveStatus.Pending, payload: serializePendingPayload({ downloadId, fileId }) };
                return { status: ResolveStatus.Failed };
            }

            const file = getPreferredFile(listItemData.files, source.fileName);
            if (file) fileId = file.id;
        }
        if (typeof fileId !== "number")
            return { status: ResolveStatus.UnknownFailure };

        // Get the final download URL
        const dlUrl = new URL("/v1/api/usenet/requestdl", API_ROOT);
        dlUrl.searchParams.set("token", config.apiKey);
        dlUrl.searchParams.set("usenet_id", `${downloadId}`);
        dlUrl.searchParams.set("file_id", `${fileId}`);
        return {
            status: ResolveStatus.Succeeded,
            url: await fetch(dlUrl).then(r => r.json()).then(j => j.data),
        };
    },
} as const satisfies Provider<TorboxConfig>;