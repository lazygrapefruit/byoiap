import { newznabIndexer } from "./newznab";
import type { Indexer } from "./types";
export type { Indexer } from "./types";
import { type Static } from '@sinclair/typebox';

// This can be translated to a union in the future, but TypeBox misbehaves
// if creating a union of one element.
const INDEXER = newznabIndexer;

export const IndexerConfig = INDEXER.configSchema;
export type IndexerConfig = Static<typeof IndexerConfig>;

export const ALL_INDEXERS = (() => {
    const indexers = new Map<string, Indexer>();
    indexers.set(INDEXER.id, INDEXER);
    return indexers;
})();