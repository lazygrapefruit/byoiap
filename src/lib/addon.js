/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { addonBuilder } from "stremio-addon-sdk";
import { streamHandler } from "./addon-handlers";

// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
const manifest = {
    id: "community.byoiap",
    name: "byoiap",
    description: "Bring Your Own Indexer and Provider",
    version: "0.0.1",

    catalogs: [],
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],

    behaviorHints: {
        configurable: true,
        configurationRequired: true,
    },
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(streamHandler);

export default builder.getInterface();
