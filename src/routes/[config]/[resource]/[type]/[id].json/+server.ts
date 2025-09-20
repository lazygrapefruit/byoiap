import { handleGet } from "$lib/server/addon-resource";
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, params }) => {
	return handleGet(url, params);
};