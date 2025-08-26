import { handleGet } from '../[id]/[extra].json/handle-get';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, params }) => {
	return handleGet(url, params);
};