import { configDeserialize } from '$lib/server/config';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ALL_PROVIDERS } from '$lib/provider';
import { ALL_INDEXERS } from '$lib/indexer';
import { getShowData, ShowId } from '$lib/media-id';
import { compareDisplayScore, displayScore, getExpectedQuality, isCompoundEpisode } from '$lib/title-utils';
import type { IndexedItem } from '$lib/indexer/types';

function replaceEpisodeNumber(input: string, targetSeason: number, targetEpisode: number) {
    // Regular expression to match the pattern SxxExx or Sxxexx
    const regex = /(s)(\d{2})(e)(\d{2})/i;

    // Format the target season and episode numbers to two digits
    const newSeason = String(targetSeason).padStart(2, '0');
    const newEpisode = String(targetEpisode).padStart(2, '0');

    // Replace function to set the target season and episode number
    return input.replace(regex, (match, p1, p2, p3) => {
        // Return the modified string with the new season and episode numbers
        return `${p1}${newSeason}${p3}${newEpisode}`;
    });
}

/**
 * This counts the matches from both ends. This makes it likely that it will ignore inner segments
 * such as the episode name.
 */
function getMatchingCount(str1: string, str2: string) {
    let matching = 0;
    const minLength = Math.min(str1.length, str2.length);

    for (let i = 0; i < minLength && str1[i] === str2[i]; ++i)
        matching++;

    const remaining = minLength - matching;
    for (let i = 0; i < remaining && str1[str1.length - 1 - i] === str2[str2.length - 1 - i]; ++i)
        matching++;

    return matching;
}

function errorAndLog(statusCode: number, message: string): never {
    console.error(`[error] ${statusCode}: ${message}`);
    error(statusCode, message);
}

export const GET: RequestHandler = async ({ url, params }) => {
    console.log("[cachenext]", url.toString());
    const config = await configDeserialize(params.config);
    const title = url.searchParams.get("title") ?? "";

    const indexer = ALL_INDEXERS.get(config.indexer.id);
    if (!indexer)
        errorAndLog(400, `${config.indexer.id} does not have a registered indexer`);

    const provider = ALL_PROVIDERS.get(config.provider.id);
    if (!provider)
        errorAndLog(400, `${config.provider.id} does not have a registered provider`);

    const cacheChecker = provider.buildCacheChecker(config.provider);
    const showId = new ShowId(params.id);
    const showData = await getShowData(showId.imdbId);

    let nextEpisodeSeason = showId.season;
    let nextEpisodeNumber = showId.episode;
    for (let i = 0; i < config.shared.nextEpisodeCacheCount; ++i) {
        const episodesInSeason = showData.episodesPerSeason[nextEpisodeSeason] ?? 0;
        if (nextEpisodeNumber < episodesInSeason) {
            nextEpisodeNumber += 1;
        }
        else {
            nextEpisodeSeason += 1;
            nextEpisodeNumber = 1;
            if ((showData.episodesPerSeason[nextEpisodeSeason] ?? 0) < nextEpisodeNumber)
                errorAndLog(400, `Unable to find episode following ${params.id}`);
        }

        // Construct the show id in a less silly way.
        const nextEpisodeId = `${showId.imdbId}:${nextEpisodeSeason}:${nextEpisodeNumber}`;
        const items = await indexer.query(config.indexer, new ShowId(nextEpisodeId));
        const cachePromise = cacheChecker(items); // Populates status in the items

        const targetQuality = getExpectedQuality(title);
        const targetTitle = replaceEpisodeNumber(title, nextEpisodeSeason, nextEpisodeNumber);

        let bestItem: IndexedItem | undefined;

        // First pass looks for the item with the same quality that has the best
        // name match.
        {
            let bestMatchingCount = -1;
            for (const item of items) {
                item.expectedQuality ??= getExpectedQuality(item.title);
                if (item.expectedQuality !== targetQuality)
                    continue;

                if (isCompoundEpisode(item.title))
                    continue;

                const d = getMatchingCount(targetTitle, item.title);
                if (d > bestMatchingCount) {
                    bestMatchingCount = d;
                    bestItem = item;
                }
            }
        }

        // Since we use status below here it needs to be awaited here
        await cachePromise;

        // If the best item is failed then unset it so that we find a new best item
        if (bestItem?.status === "failed")
            bestItem = undefined;

        // If that failed that means there are no items with the same quality to
        // choose from. So now the best item is just whatever would've been at the
        // front of the display list when sorted.
        if (!bestItem && items.length) {
            let bestDisplayScore: ReturnType<typeof displayScore> | undefined;
            for (const item of items) {
                // Don't pick a failed item.
                if (item.status === "failed")
                    continue;

                const currentDisplayScore = displayScore(config, item);
                if (bestDisplayScore && (compareDisplayScore(currentDisplayScore, bestDisplayScore) > 0))
                    continue;

                bestItem = item;
                bestDisplayScore = currentDisplayScore;
            }
        }

        if (!bestItem)
            errorAndLog(400, `Unable to find episode stream matching ${nextEpisodeId}`);

        console.log(`[cachenext] "${title}" + ${i + 1} = "${bestItem.title}"`);

        // If the best item has a relevant status then the precaching can be skipped.
        switch (bestItem.status) {
            case "cached":
            case "downloading":
            case "ready":
                continue;
        }

        await provider.precache(config.provider, {
            kind: "usenet",
            ...bestItem,
        });
    }

    return json({ success: true });
};