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

async function createDownload(config: TorboxConfig, source: DownloadSource, sync = true) {
    const formData = new FormData();
    formData.set("link", source.url);
    if (source.password)
        formData.set("password", source.password);

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

export const torboxProvider = {
    id: ID,
    configSchema: TorboxConfig,

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
        for (const file of json.data.files) {
            if (source.fileName) {
                if (file.short_name !== source.fileName)
                    continue;
            }
            else if (typeof file.opensubtitles_hash !== "string") {
                continue;
            }

            const dlUrl = new URL("/v1/api/usenet/requestdl", API_ROOT);
            dlUrl.searchParams.set("token", config.apiKey);
            dlUrl.searchParams.set("usenet_id", json.data.id);
            dlUrl.searchParams.set("file_id", String(file.id));
            return {
                status: ResolveStatus.Succeeded,
                url: await fetch(dlUrl).then(r => r.json()).then(j => j.data),
            };
        }

        if (!json.download_finished)
            return { status: ResolveStatus.Pending, payload: downloadId };

        return { status: ResolveStatus.UnknownFailure };
    },
    cached: async function(config, items) {
        Value.Assert(TorboxConfig, config);
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

        const result: typeof items = [];
        await Promise.all(requests.map(async (response) => {
            const json = await (await response).json();
            if (!json.data) return;
            for (const { hash, files } of json.data) {
                const item = hashToItem.get(hash);
                if (!item) continue;
                result.push(item);
                
                for (const file of files) {
                    // For now, just assuming that the opensubtitles_hash indicates
                    // the media being looked for.
                    if (!file.opensubtitles_hash) continue;
                    item.fileName = file.short_name;
                    item.mimetype = file.mimetype;
                    item.openSubtitlesHash = file.opensubtitles_hash;
                    item.size = file.size;
                    break;
                }
            }
        }));

        return result;
    }
} as const satisfies Provider<TorboxConfig>;