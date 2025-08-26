import TTLCache from "@isaacs/ttlcache";

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

interface TvMazeEpisode {
    season: number;
    number: number;
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

// TODO: Handle exceptions and retries
async function fetchShowData(imdbId: string): Promise<ShowData> {
    const imdbLookupResponse = await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${imdbId}`);
    const imdbLookupJson: TvMazeShow | null = await imdbLookupResponse.json();
    if (!imdbLookupJson) {
        console.log(`Failed to find TVMaze entry for ${imdbId}`);
        return { imdbId, episodesPerSeason: [] };
    }

    const episodeLookup = await fetch(`https://api.tvmaze.com/shows/${imdbLookupJson.id}/episodes`);
    const episodeLookupJson: TvMazeEpisode[] = await episodeLookup.json();

    const episodesPerSeason: number[] = [];
    for (const episode of episodeLookupJson) {
        const episodesInSeason = episodesPerSeason[episode.season] ?? 0;
        episodesPerSeason[episode.season] = Math.max(episode.number, episodesInSeason);
    }

    // Fill any gaps
    for (let i = 0; i < episodesPerSeason.length; ++i)
        episodesPerSeason[i] ??= 0;

    return {
        imdbId,
        tvMazeId: imdbLookupJson.id,
        tvRageId: imdbLookupJson.externals?.tvrage ?? undefined,
        tvdbId: imdbLookupJson.externals?.thetvdb ?? undefined,
        episodesPerSeason,
    };
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