import TTLCache from "@isaacs/ttlcache";
import assert from "assert";
import type { Writable } from "type-fest";

export class MovieId {
    constructor(public readonly imdbId: string) { }
};

export class ShowId {
    public readonly season: number;
    public readonly episode: number;
    public readonly imdbId: string;

    constructor(imdbId: string) {
        const [show, season, episode] = imdbId.split(":");
        this.imdbId = show;
        this.season = Number.parseInt(season);
        this.episode = Number.parseInt(episode);
    }
};

export type MediaId = MovieId | ShowId;

interface TvMazeShow {
    id: number;
    externals: {
        tvrage?: number | undefined | null;
        thetvdb?: number | undefined | null;
        imdb?: string | undefined | null;
    };
}

interface CinemetaSeries {
    readonly meta: {
        readonly videos: {
            readonly season: number;
            readonly episode: number;
        }[];
    };
}

interface ShowData {
    readonly imdbId: string;
    readonly tvMazeId?: number;
    readonly tvRageId?: number;
    readonly tvdbId?: number;
    readonly episodesPerSeason: number[];
}

const _shouldRevive = new Set<string>();
const _showDataCache = new TTLCache<string, ShowData | Promise<ShowData>>({
    ttl: 1000 * 60 * 60 * 12, // 12 hours
    max: 10000, // Some bounds to prevent consuming infinite memory
    dispose: (value, key, reason) => {
        const shouldRevive = _shouldRevive.delete(key);

        // Attempt to revive the item. Only applies to items that were evicted due
        // to being stale and were marked for revival.
        if (shouldRevive && reason === "stale")
            fetchAndCacheShowData(key);
    },
});

async function insertFromTvMaze(imdbId: string, data: Writable<ShowData>) {
    const tvmazeLookup = await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${imdbId}`);
    const lookupJson: TvMazeShow | null = await tvmazeLookup.json();
    if (!lookupJson) {
        console.warn(`Could not find TvMaze entry for ${imdbId}`);
        return;
    }

    data.tvMazeId = lookupJson.id;
    if (lookupJson.externals.thetvdb)
        data.tvdbId = lookupJson.externals.thetvdb;
    if (lookupJson.externals.tvrage)
        data.tvRageId = lookupJson.externals.tvrage;
}

async function insertFromCinemeta(imdbId: string, data: Writable<ShowData>) {
    const cinemetaResponse = await fetch(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
    const cinemetaJson: CinemetaSeries = await cinemetaResponse.json();

    const episodesPerSeason = data.episodesPerSeason;
    assert(episodesPerSeason.length === 0);

    for (const episode of cinemetaJson.meta.videos) {
        const episodesInSeason = episodesPerSeason[episode.season] ?? 0;
        episodesPerSeason[episode.season] = Math.max(episode.episode, episodesInSeason);
    }

    // Fill any gaps
    for (let i = 0; i < episodesPerSeason.length; ++i)
        episodesPerSeason[i] ??= 0;
}

// TODO: Handle exceptions and retries
async function fetchShowData(imdbId: string): Promise<ShowData> {
    const result: Writable<ShowData> = {
        imdbId,
        episodesPerSeason: [],
    };

    await Promise.all([insertFromTvMaze(imdbId, result), insertFromCinemeta(imdbId, result)]);
    return result;
}

function fetchAndCacheShowData(imdbId: string) {
    const fetcher = fetchShowData(imdbId);
    _showDataCache.set(imdbId, fetcher);
    fetcher.then(v => _showDataCache.set(imdbId, v));
    return fetcher;
}

export function getShowData(imdbId: string) {
    _shouldRevive.add(imdbId);
    return _showDataCache.get(imdbId) ?? fetchAndCacheShowData(imdbId);
}