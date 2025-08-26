export { type Provider } from "./types";
import { type Provider } from "./types";
import { torboxProvider } from "./torbox";
import { type Static } from '@sinclair/typebox';

// This can be translated to a union in the future, but TypeBox misbehaves
// if creating a union of one element.
const PROVIDER = torboxProvider;

export const ProviderConfig = PROVIDER.configSchema;
export type ProviderConfig = Static<typeof ProviderConfig>;

export const ALL_PROVIDERS = (() => {
    const resolvers = new Map<string, Provider>();
    resolvers.set(PROVIDER.id, PROVIDER);
    return resolvers;
})();