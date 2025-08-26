import type { RequestHandler } from './$types';
import addonInterface from "$lib/addon";
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = ({ params }) => {
	const manifest = { ...addonInterface.manifest };
	if (params.config) {
		manifest.behaviorHints = {
			...manifest.behaviorHints,
			configurationRequired: false,
		};
	}
	return json(manifest);
};