import type { RequestHandler } from './$types';
import { handleGet } from "./handle-get";

export const GET: RequestHandler = async ({ url, params }) => {
	return handleGet(url, params);
};