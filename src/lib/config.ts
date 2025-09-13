import { Type, type Static } from '@sinclair/typebox';
import { IndexerConfig } from "$lib/indexer";
import { ProviderConfig } from "$lib/provider";
import { CborEncoder } from '@jsonjoy.com/json-pack/lib/cbor/CborEncoder';
import { CborDecoderBase } from '@jsonjoy.com/json-pack/lib/cbor/CborDecoderBase';
import zlib from "zlib";
import { Value } from '@sinclair/typebox/value';
import { promisify } from 'util';
import assert from 'assert';

export const Config = Type.Object({
    indexer: IndexerConfig,
    provider: ProviderConfig,
    shared: Type.Object({
        id: Type.Readonly(Type.Literal("shared", {
            title: "Shared",
            default: "shared",
        })),
        nextEpisodeCacheCount: Type.Readonly(Type.Number({
            title: "Next Episode Cache Count",
            description: "The number of episodes to attempt to cache when starting a video",
            minimum: 0,
            maximum: 10,
            default: 1,
            multipleOf: 1,
        })),
        pendingRetrySeconds: Type.Readonly(Type.Number({
            title: "Pending Retry Seconds",
            description: "How long to poll retry while download is pending. Prevents show failure videos.",
            minimum: 0,
            maximum: 600,
            default: 180,
            multipleOf: 1,
        })),
        preferredQualities: Type.Readonly(Type.Array(Type.Number(), {
            title: "Preferred Quality",
            description: 'Qualities ordered by preference. Use numbers such as 1080 to mean 1080p',
            default: [],
            maxItems: 10,
        })),
        preferredAudioLanguages: Type.Readonly(Type.Array(Type.String(), {
            title: "Preferred Audio Languages",
            description: 'Audio languages ordered by preference. Use short codes, such as "en" for "English"',
            default: ["en"],
            maxItems: 10,
        })),
        preferredSubtitleLanguages: Type.Readonly(Type.Array(Type.String(), {
            title: "Preferred Subtitle Languages",
            description: 'Subtitle languages ordered by preference. Use short codes, such as "en" for "English"',
            default: ["en"],
            maxItems: 10,
        })),
    }),
});
export type Config = Static<typeof Config>;

const encoder = new CborEncoder();
const decoder = new CborDecoderBase();
const compress = promisify(zlib.brotliCompress);
const decompress = promisify(zlib.brotliDecompress);

async function configSerializeB64(config: Config) {
    const compressed = await compress(encoder.encode(Value.Clean(Config, config)));
    return compressed.toString("base64url");
}

async function configDeserializeB64(configStr: string) {
    const decoded = decoder.decode(await decompress(Buffer.from(configStr, "base64url")));
    return Value.Parse(Config, decoded);
}

const FIXED_CONFIG = (() => {
    if (!process.env.FIXED_CONFIG) return undefined;
    return configDeserializeB64(process.env.FIXED_CONFIG);
})();

function configSerializeFixed() {
    return "fixed";
}

function configDeserializedFixed(configStr: string) {
    assert(configStr === "fixed");
    assert(FIXED_CONFIG);
    return FIXED_CONFIG;
}

export const configIsFixed = Boolean(FIXED_CONFIG);
export const configSerialize = configIsFixed ? configSerializeFixed : configSerializeB64;
export const configDeserialize = configIsFixed ? configDeserializedFixed : configDeserializeB64;