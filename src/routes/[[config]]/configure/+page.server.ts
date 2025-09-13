import type { PageServerLoad } from './$types';
import { Config } from '$lib/config';
import { decodeConfig } from './data.remote';

// Strip the symbols this lazy way of just serializing and deserializing.
// The reason I'm doing this is just so that I don't have to deal with
// the client trying to import the heavy lib files meant for the server,
// but still have access to the schema.
const configSchema =  JSON.parse(JSON.stringify(Config)) as typeof Config;

export const load: PageServerLoad = async ({ params }) => {
    return {
        schema: configSchema,
        config: await decodeConfig(params.config),
    };
};