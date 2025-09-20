import { AddonConfig } from "$lib/config";
import { Type, type Static } from '@sinclair/typebox';
import { CborEncoder } from '@jsonjoy.com/json-pack/lib/cbor/CborEncoder';
import { CborDecoderBase } from '@jsonjoy.com/json-pack/lib/cbor/CborDecoderBase';
import zlib from "zlib";
import { Value } from '@sinclair/typebox/value';
import { promisify } from 'util';
import assert from 'assert';
import { parse } from "smol-toml";
import path from "path";
import { readFileSync } from "node:fs";

export const ServerConfig = Type.Object({
    named: Type.ReadonlyOptional(Type.Record(Type.String(), AddonConfig)),
});
export type ServerConfig = Static<typeof ServerConfig>;

const encoder = new CborEncoder();
const decoder = new CborDecoderBase();
const compress = promisify(zlib.brotliCompress);
const decompress = promisify(zlib.brotliDecompress);

function loadServerConfig(): ServerConfig {
    const configStr = (() => {
        const configPath = process.env.CONFIG_PATH || path.resolve("byoiap.toml");
        try {
            console.info(`Loading: ${configPath}`);
            return readFileSync(configPath, "utf-8");
        }
        catch (err) {
            if (typeof err === "object" && err && "code" in err && err.code === "ENOENT")
                console.warn(`Unable to find: ${configPath}`);
            return undefined;
        }
    })();

    if (configStr) {
        // For some reason the parse fixes, such as `Default`, don't go through
        // the records automatically. For this reason I go through them manually.
        const parsed = parse(configStr) as ServerConfig;
        for (const key in parsed.named)
            parsed.named[key] = Value.Parse(AddonConfig, parsed.named[key]);
        return Value.Parse(ServerConfig, parsed);
    }

    return Value.Create(ServerConfig);
}

const serverConfig = loadServerConfig();

async function configSerializeB64(config: AddonConfig) {
    const compressed = await compress(encoder.encode(Value.Clean(AddonConfig, config)));
    return compressed.toString("base64url");
}

function configSerializeFixed() {
    return "UNUSED_NAME";
}

async function configDeserializeB64(configStr: string) {
    const decoded = decoder.decode(await decompress(Buffer.from(configStr, "base64url")));
    return Value.Parse(AddonConfig, decoded);
}

function configDeserializeFixed(configStr: string) {
    assert(serverConfig.named);
    const config = serverConfig.named[configStr];
    assert(config);
    return config;
}

export const configIsFixed = !!serverConfig.named;
export const configSerialize = configIsFixed ? configSerializeFixed : configSerializeB64;
export const configDeserialize = configIsFixed ? configDeserializeFixed : configDeserializeB64;