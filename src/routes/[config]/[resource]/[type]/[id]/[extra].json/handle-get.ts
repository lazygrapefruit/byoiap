import addonInterface from "$lib/addon";
import { INJECTED_CONFIG_KEY, type AddonConfig } from "$lib/addon-handlers";
import { configDeserialize } from "$lib/config";
import { error, json } from "@sveltejs/kit";

interface Params {
    readonly resource: string;
    readonly type: string;
    readonly id: string;
    readonly config: string;
    readonly extra?: string;
}

async function parseConfig(url: URL, configStr: string) {
    return {
        ...await configDeserialize(configStr),
        [INJECTED_CONFIG_KEY]: {
            origin: url.origin,
            configStr,
        },
    } as AddonConfig;
}

// For some strange reason Stremio decided to make extra be a raw query string. This
// means that it needs to be explicitly decoded as one. For this reason it has to be
// reencoded and then parsed as search params.
function parseExtra(extraStr: string | undefined) {
	if (extraStr)
		return Object.fromEntries(new URLSearchParams(encodeURIComponent(extraStr)).entries());
	return {};
}

export async function handleGet(url: URL, params: Params) {
    const { resource, type, id } = params;
    const config = await parseConfig(url, params.config);
    const extra = parseExtra(params.extra);

    try {
        const resp = await addonInterface.get(resource, type, id, extra, config);
        return json(resp, {
            headers: {
                'cache-control': 'private, max-age=3600',
            },
        });
    }
    catch (err: any) {
        return error(err.noHandler ? 404 : 500);
    }
}