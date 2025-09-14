import assert from "assert";
import type { Config } from "./config";
import type { IndexedItem } from "./indexer/types";

function voteScore(item: IndexedItem) {
    // down votes are weighted higher to make ties break nicer
    return (item.votesUp ?? 0) - 1.49 * (item.votesDown ?? 0);
}

export function isCompoundEpisode(title: string) {
    return /s\d{2}e\d{2}e\d{2}/i.test(title);
}



function titleScore({ title }: IndexedItem) {
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

function languageScore(foundLanguages: string[], preferredLanguages: string[]) {
    if (foundLanguages.length < 1) return 0;
    for (let i = 0; i < preferredLanguages.length; ++i) {
        if (foundLanguages.includes(preferredLanguages[i]))
            return Number.MAX_SAFE_INTEGER - i;
    }
    return -1;
}

function preferredQualityScore(expectedQuality: number, preferredQualities: number[]) {
    const foundIndex = preferredQualities.indexOf(expectedQuality);
    return foundIndex < 0 ? Number.NEGATIVE_INFINITY : -foundIndex; 
}

export function displayScore(config: Config, item: IndexedItem) {
    const expectedQuality = item.expectedQuality ?? 0;

    return [
        preferredQualityScore(expectedQuality, config.shared.preferredQualities),
        expectedQuality,
        titleScore(item),
        languageScore(item.languagesSubtitles, config.shared.preferredSubtitleLanguages),
        languageScore(item.languagesAudio, config.shared.preferredAudioLanguages),
        voteScore(item),
        item.publishDate.getTime(),
        item.url,
    ];
}

const DISPLAY_SCORE = Symbol("DisplayScore");

interface ScoredItem extends IndexedItem {
    [DISPLAY_SCORE]: ReturnType<typeof displayScore>;
}

export function compareDisplayScore(a: ScoredItem[typeof DISPLAY_SCORE], b: ScoredItem[typeof DISPLAY_SCORE]) {
    assert(a.length === b.length);
    const length = a.length;

    for (let i = 0; i < length; ++i) {
        const ia = a[i];
        const ib = b[i];
        if (ia !== ib)
            return ia < ib ? 1 : -1;
    }
    return 0;
}

function compareScoredItems(a: ScoredItem, b: ScoredItem) {
    return compareDisplayScore(a[DISPLAY_SCORE], b[DISPLAY_SCORE]);
}

export function displaySort(config: Config, items: IndexedItem[]) {
    // Score the items
    const scored = items as ScoredItem[];
    for (const item of scored)
        item[DISPLAY_SCORE] = displayScore(config, item);

    // Sort the items
    scored.sort(compareScoredItems);
}

export function getExpectedQuality(title: string) {
    const expectedQuality = /(?:[^a-zA-Z0-9]|^)(\d+)p(?:[^a-zA-Z0-9]|$)/.exec(title)?.[1];
    return expectedQuality ? Number.parseInt(expectedQuality) : undefined;
}

export function getExpectedEpisode(title: string) {
    const regex = /(?<![a-z0-9])s(?<season>\d{2})(?:e(?<episode>\d{2}))?(?![a-z0-9])/i;
    let match = title.match(regex);
    if (!match?.groups)
        return undefined;

    const { season, episode } = match.groups;
    return {
        season: Number.parseInt(season),
        episode: episode ? Number.parseInt(episode) : undefined,
    };
}