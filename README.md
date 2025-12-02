# BYOIAP

This is a Stremio Addon to Bring Your Own Indexer And Provider. It is incomplete and currently meant to be self-hosted, but if interest is present I may expand it and publish it for the community. I will not make any backward compatibility guarantees prior to a full release, so if you use this I encourage you to version or SHA pin it to avoid breakages.

## Features

* Support for Newznab-compatible Usenet indexers. Using NZBHydra2 as a proxy is recommended, but not required if the indexer is compatible.
* TorBox as a usenet debrid provider.
* Next episode warming. It looks for the episode most like the playing episode and instructs the debrid provider to download it so it will be ready to play.
* Ability to use named configs in place of dynamic configs.
* Reports when it is aware that identifiers failed to be translated to supported formats. In this case the best course of action is to help out by sending a data edit request to TVmaze to add it.

## Non-Features

* This is never intended to compete with the feature set of NZBHydra2 and as a result will never contain features for aggregating indexers or doing extended configuration on indexers. If you need those tools use NZBHydra2 and point this addon to it. I will do my best to make well-formed indexers work without needing a proxy, but I am limited to developing against and testing for indexers I have access to. So in some cases you may be best served by having NZBHydra2 proxy for you anyway so it can deal with behaviors I haven't encountered.

## Usage

While this is just a basic node application that you can build however you want, it was designed to run in a Docker container so that it could easily fit into compose stacks alongside other services. Check https://github.com/lazygrapefruit/byoiap/pkgs/container/byoiap for images.

### Configuration

* PORT - Port to run on. Defaults to 3000. It is recommended you set this but do not directly expose it. Prefer to leave exposing it up to something more secure, such as a reverse proxy.
* /config/config.toml is a TOML file that contains configuration. The file path can be modified with CONFIG_PATH. When any named config sections are present only names are supported and the configuration page intentionally no longer functions. An example config file, one that that is fully commented out, resides at [byoiap.toml](byoiap.toml).

## Known Issues

1. Not yet gathering the client's IP address to forward to services which accept it. This is not particularly helpful for self-hosted anyway, but could be useful for the community version where indexers or providers may want it to control rate limiting in a more helpful way than throttling the entire addon.
2. Does not handle all possible ID configurations, but I could add more upon request. At present it expects the incoming ID to always be IMDB, expects that IMDB works for movies, and assumes that one of the ID options available from TVmaze (TVmaze, IMDB, or TheTVDB) will work for series.
3. The code is a bit over-complicated. Don't really need SvelteKit for this, especially because there's only one page, but I wanted to experiment with SvelteKit at the time I started this project.
4. Only one indexer and provider type are currently supported. It is designed to be extended, but nothing else is currently implemented.
5. Cache controls are incomplete. This makes some behaviors, such as Stremio fetching the streams for the next episode when starting an episode, entirely wasted work.
6. The way next episode caching is invoked is messy. It was originally based around a pattern more useful for serverless (ie. serverless functions are often suspended after the response is emitted so to get extra async work to happen something else must be done, such as emitting an event to some kind of queue or even just invoking another serverless function but not awaiting its results).
7. If using NZBHydra2 and the TorBox Usenet indexer you **must** use NZB redirects rather than proxying in NZBHydra2. This is a limitation I cannot work around. It is caused by TorBox not serving the NZB files its indexer returns.
