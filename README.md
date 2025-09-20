# BYOIAP

This is a Stremio Addon to Bring Your Own Indexer And Provider. It is incomplete and currently meant to be self-hosted, but if interest is present I may expand it and publish it for the community. I will not make any backward compatibility guarantees prior to a full release, so if you use this I encourage you to version or SHA pin it to avoid breakages.

## Features

* Support for Newznab-compatible Usenet indexers. Using NZBHydra2 as a proxy is recommended, but not required if the indexer is compatible.
* TorBox as a usenet debrid provider.
* Next episode warming. It looks for the episode most like the playing episode and instructs the debrid provider to download it so it will be ready to play.
* Option to replace config with a fixed config. The primary use case for this is to allow hosting this on the same network as other services, but without being able to exploit putting localhost URLs into the text boxes. I'm likely to change how this is implemented in the future, so if you depend on this make sure to version pin for safe upgrades.

## Non-Features

* This is never intended to compete with the feature set of NZBHydra2 and as a result will never contain features for aggregating indexers or doing extended configuration on indexers. If you need those tools use NZBHydra2 and point this addon to it. I will do my best to make well-formed indexers work without needing a proxy, but I am limited to developing against and testing for indexers I have access to. So in some cases you may be best served by having NZBHydra2 proxy for you anyway so it can deal with behaviors I haven't encountered.

## Usage

While this is just a basic node application that you can build however you want, it was designed to run in a Docker container so that it could easily fit into compose stacks alongside other services. Check https://github.com/lazygrapefruit/byoiap/pkgs/container/byoiap for images.

### Configuration

* PORT - Port to run on. Defaults to 3000. It is recommended you set this but do not directly expose it. Prefer to leave exposing it up to something more secure, such as a reverse proxy.
* /config/config.toml is a TOML file that contains configuration. The file path can be modified with CONFIG_PATH. When any named config sections are present only names are supported and the configuration page intentionally no longer functions. An example config file, one that that is fully commented out, resides at [byoiap.toml](byoiap.toml).

## Known Issues

1. Not yet gathering the client's IP address to forward to services which accept it. This is not particularly helpful for self-hosted anyway, but could be useful for the community version where indexers or providers may want it to control rate limiting in a more helpful way than throttling the entire addon.
2. Configuration is not entirely obvious. It is also encoded in an unclear fashion.
3. The code is a bit over-complicated. Don't really need SvelteKit for this, especially because there's only one page.
4. Only one indexer and provider are currently supported. It is designed to be extended, but nothing else is currently implemented.
5. Cache controls are incomplete. This makes some behaviors, such as Stremio fetching the streams for the next episode when starting an episode, entirely wasted work.
6. The way next episode caching is invoked should be rewritten. It was originally based around a pattern more useful for serverless (ie. serverless functions are often suspended after the response is emitted so to get extra async work to happen something else must be done, such as emitting an event to some kind of queue or even just invoking another serverless function but not awaiting its results).
7. If using NZBHydra2 and the TorBox Usenet indexer you **must** use NZB redirects rather than proxying in NZBHydra2. This is a limitation I cannot work around. It is caused by TorBox not serving the NZB files its indexer returns.
