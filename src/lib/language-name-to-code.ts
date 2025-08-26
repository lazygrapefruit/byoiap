// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import { data } from "language-emoji";

export const LANGUAGE_NAME_TO_CODE = Object.freeze(Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
        return [(value as { name: string }).name.toLowerCase(), key];
    })
));

export function languageNameToCode(name: string): string | undefined {
    return LANGUAGE_NAME_TO_CODE[name.toLowerCase()];
}