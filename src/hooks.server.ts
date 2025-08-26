import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
    console.log(`[handle] ${event.request.method} ${event.url}`);
	const response = await resolve(event);

    // This application intends for its endpoints to be called by other applications
    // and so explicitly allows this.
    if (!response.headers.has('Access-Control-Allow-Origin'))
        response.headers.set('Access-Control-Allow-Origin', '*');

    console.log(`[handle response] ${event.request.method} ${event.url} -> ${response.status} ${response.statusText}`);
	return response;
};