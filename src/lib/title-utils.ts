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
            return i + 1;
    }
    return -1;
}

export function makeDisplayCompare(config: Config) {
    const preferredQualities = config.shared.preferredQualities.toReversed();
    const preferredAudioLanguages = config.shared.preferredAudioLanguages.toReversed();
    const preferredSubtitleLanguages = config.shared.preferredSubtitleLanguages.toReversed();

    return (a: IndexedItem, b: IndexedItem) => {
        const expectedQualityA = a.expectedQuality ?? 0;
        const expectedQualityB = b.expectedQuality ?? 0;

        // Preferred qualities get a special higher preference.
        const preferredQualityScoreDelta = preferredQualities.indexOf(expectedQualityA) - preferredQualities.indexOf(expectedQualityB);
        if (preferredQualityScoreDelta)
            return -preferredQualityScoreDelta;

        // Sort qualities descending by default
        const qualityScoreDelta = expectedQualityA - expectedQualityB;
        if (qualityScoreDelta)
            return -qualityScoreDelta;

        // Deal with quality issues, such as compound episodes
        const titleScoreDeleta = titleScore(a) - titleScore(b);
        if (titleScoreDeleta)
            return -titleScoreDeleta;

        // Prefer subtitles being available and appropriately tagged
        const subtitleScoreDelta = languageScore(a.languagesSubtitles, preferredSubtitleLanguages)
            - languageScore(b.languagesSubtitles, preferredSubtitleLanguages);
        if (subtitleScoreDelta)
            return -subtitleScoreDelta;

        // Prefer audio being available and appropriately tagged
        const audioScoreDelta = languageScore(a.languagesAudio, preferredAudioLanguages)
            - languageScore(b.languagesAudio, preferredAudioLanguages);
        if (audioScoreDelta)
            return -audioScoreDelta;

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
        return  a.url < b.url ? 1 : -1;
    };
}

export function getExpectedQuality(title: string) {
    const expectedQuality = /(?:[^a-zA-Z0-9]|^)(\d+)p(?:[^a-zA-Z0-9]|$)/.exec(title)?.[1];
    return expectedQuality ? Number.parseInt(expectedQuality) : undefined;
}

export function getExpectedEpisode(title: string) {
    // Regular expression to match the pattern SxxExx or Sxxexx
    const regex = /(s)(?<season>\d{2})(e)(?<episode>\d{2})/i;

    const match = title.match(regex);
    if (!match?.groups)
        return undefined;

    const { season, episode } = match.groups;
    return {
        season: Number.parseInt(season),
        episode: Number.parseInt(episode),
    };
}