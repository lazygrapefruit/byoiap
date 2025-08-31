import { configDeserialize } from '$lib/config';
import { ALL_PROVIDERS } from '$lib/provider';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DownloadSource, ResolveStatus } from '$lib/provider/types';
import { Value } from '@sinclair/typebox/value';
import { setTimeout } from 'timers/promises';
import TTLCache from "@isaacs/ttlcache";

const enum MaxAge {
    Success = 60 * 60,
    PendingBase = 60 * 2, // The max retry seconds get added to this
    Failure = 1,
}

// Stremio has a tendency to attempt to hit the resolve URL repeatedly
// before any processing could be done (ex. both GET and HEAD immediately).
// This cache is meant to reduce impact downstream when generating the cache
// by avoiding triggering rapid duplicate-like requests.
interface ResolveResult {
    readonly url: string;
    readonly maxAge: number;
}

const _resolveCache = new TTLCache<string, Promise<ResolveResult> | ResolveResult>({
    max: 10000,     // This bound should never be reached, but just helps protect memory usage
    ttl: MaxAge.PendingBase * 1000,
});

export const GET: RequestHandler = async (event) => {
    const { url, params, fetch } = event;
    console.log(`[resolve] ${url}`);

    const cacheKey = `${url}`;
    const config = await configDeserialize(params.config);
    const retrySeconds = config.shared.pendingRetrySeconds;

    const provider = ALL_PROVIDERS.get(config.provider.id);
    if (!provider)
        error(400, `${config.provider.id} does not have a registered provider`);

    let resolving = _resolveCache.get(cacheKey);
    if (!resolving) {
        const downloadSource = Value.Parse(DownloadSource, Object.fromEntries(url.searchParams.entries()));

        resolving = (async () => {
            const resolveAttemptStart = Date.now();
            const result = await provider.resolve(config.provider, downloadSource);
            if (result.status === ResolveStatus.Succeeded) {
                // Since this was a success, start the async chain before returning.
                // If this was in a more complex serverless system this would probably
                // just be an event.
                const asyncChain = url.searchParams.get("asyncChain");
                if (typeof asyncChain === "string")
                    fetch(asyncChain).catch(() => { /* do nothing */ });

                return {
                    url: result.url,
                    maxAge: MaxAge.Success,
                };
            }

            const now = Date.now();
            const retryEndSearch = url.searchParams.get("retryEnd");
            const retryEnd = retryEndSearch ? Number.parseInt(retryEndSearch) : now + retrySeconds * 1000;
            const timeRemaining = retryEnd - now;
            if (result.status === ResolveStatus.Pending && timeRemaining > 0) {
                // Factoring in the time the resolve attempt took is to help particularly long resolve attempts
                // from timing out the client due to adding the additional 30 seconds.
                const resolveAttemptElapsed = now - resolveAttemptStart;
                const resolveAttemptTimeRemaining = Math.max(0, 1000 * 60 - resolveAttemptElapsed);

                // Wait a few seconds and then redirect back to this same URL, but with a retry end. The reason to
                // do this is that it prevents the client from timing out while still in the allowed retry window.
                await setTimeout(Math.min(30 * 1000, timeRemaining, resolveAttemptTimeRemaining));
                const retryUrl = new URL(url);
                if (typeof result.payload === "string")
                    retryUrl.searchParams.set("pendingPayload", result.payload);
                retryUrl.searchParams.set("retryEnd", `${retryEnd}`);
                retryUrl.searchParams.set("_bust", `${now}`);
                return {
                    url: `${retryUrl}`,
                    maxAge: MaxAge.PendingBase + retrySeconds,
                };
            }

            // Failures also remove themselves from the cache so that attempts to fix the issue, such as
            // freeing up slots with the debrid provider, don't cause the same failure to keep being emitted.
            _resolveCache.delete(cacheKey);
            return {
                url: "https://torrentio.strem.fun/videos/failed_unexpected_v2.mp4", // TODO: Use actually appropriate failure video
                maxAge: MaxAge.Failure,
            };
        })();
        _resolveCache.set(cacheKey, resolving);
    }

    const resolved = await resolving;
    console.log("[resolved]", resolved);
    return new Response(null, {
        status: 303,
        headers: {
            'location': resolved.url,
            'cache-control': `private, max-age=${resolved.maxAge}`,
        },
    });
};