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

function loadServerConfig() {
    const configStr = (() => {
        const configPath = process.env.CONFIG_PATH || path.resolve("config.toml");
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

// For some very dumb reason the server config seems to need to be
// dynamically loaded even though though it is actually static.
let _serverConfig: ReturnType<typeof loadServerConfig> | undefined;
function getServerConfig() {
    return _serverConfig ??= loadServerConfig();
}

export async function configIsFixed() {
    return !!(await getServerConfig()).named;
}

export async function configSerialize(config: AddonConfig) {
    const serverConfig = await getServerConfig();

    // Deal with named configs
    if (serverConfig.named)
        return "UNUSED_NAME";

    // Deal with base64 configs
    const compressed = await compress(encoder.encode(Value.Clean(AddonConfig, config)));
    return compressed.toString("base64url");
}

export async function configDeserialize(configStr: string) {
    const serverConfig = await getServerConfig();

    // Deal with named configs
    if (serverConfig.named) {
        const config = serverConfig.named[configStr];
        assert(config);
        console.log(config);
        return config;
    }

    // Deal with base64 configs
    const decoded = decoder.decode(await decompress(Buffer.from(configStr, "base64url")));
    return Value.Parse(AddonConfig, decoded);
}