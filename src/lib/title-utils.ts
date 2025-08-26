import type { IndexedItem } from "./indexer/types";

// Higher index is higher preference. This is backward from how it would likely be represented (ex. 1080p,720p)
const PREFERRED_QUALITIES: (number | undefined)[] = [];

function voteScore(item: IndexedItem) {
    // down votes are weighted higher to make ties break nicer
    return item.votesUp - 1.49 * item.votesDown;
}

export function isCompoundEpisode(title: string) {
    return /s\d{2}e\d{2}e\d{2}/i.test(title);
}

function titleScore(item: IndexedItem) {
    const { title } = item;

    // Deprioritize compound episodes
    if (isCompoundEpisode(title))
        return -1;

    // If the title contains the word "censored" or "uncensored"
    // it generally means that multiple version exist and should be
    // prioritized or deprioritized accordingly.
    if (/uncensored/i.test(title))
        return 1;
    if (/censored/i.test(title))
        return -1;

    return 0;
}

export function displayCompare(a: IndexedItem, b: IndexedItem) {
    // Preferred qualities get a special higher preference.
    const preferredQualityScoreDelta = PREFERRED_QUALITIES.indexOf(a.expectedQuality) - PREFERRED_QUALITIES.indexOf(b.expectedQuality);
    if (preferredQualityScoreDelta)
        return -preferredQualityScoreDelta;

    // Sort qualities descending by default
    const qualityScoreDelta = (a.expectedQuality ?? 0) - (b.expectedQuality ?? 0);
    if (qualityScoreDelta)
        return -qualityScoreDelta;

    const titleScoreDeleta = titleScore(a) - titleScore(b);
    if (titleScoreDeleta)
        return -titleScoreDeleta;

    // Prefer subtitles being available

    // Then by votes (votes can approximate if it is likely to be up).
    const voteScoreDelta = voteScore(a) - voteScore(b);
    if (voteScoreDelta)
        return -voteScoreDelta;

    // // Not sure if age or number of grabs is a better metric. For now I'll assume newer pubDate is better.
    const pubDateDelta = a.publishDate.getTime() - b.publishDate.getTime();
    if (pubDateDelta)
        return -pubDateDelta;

    // Trying grabs instead. Maybe the better solution is some combination of the two.
    // const grabsDelta = a.grabs - b.grabs;
    // if (grabsDelta)
    //     return -grabsDelta;

    // This is exceedingly unlikely to ever happen (requires identical publish time, votes, and quality), but
    // to keep the sort stable the fallback will just be the URL.
    return  a.title < b.title ? 1 : -1;
}

export function getExpectedQuality(title: string) {
    const expectedQuality = /(?:[^a-zA-Z0-9]|^)(\d+)p(?:[^a-zA-Z0-9]|$)/.exec(title)?.[1];
    return expectedQuality ? Number.parseInt(expectedQuality) : undefined;
}