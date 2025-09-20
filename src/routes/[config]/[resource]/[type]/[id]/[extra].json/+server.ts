import type { RequestHandler } from './$types';
import { handleGet } from "$lib/server/addon-resource";

export const GET: RequestHandler = async ({ url, params }) => {
	return handleGet(url, params);
};