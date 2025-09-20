import { query } from '$app/server';
import { AddonConfig } from '$lib/config/addon';
import { configDeserialize, configIsFixed, configSerialize } from '$lib/server/config';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const encodeConfig = query("unchecked", async (formValue: AddonConfig) => {
    Value.Assert(AddonConfig, formValue);
    return configSerialize(formValue);
});

export const decodeConfig = query("unchecked", async (configStr: string | undefined) => {
    Value.Assert(Type.Union([Type.String(), Type.Undefined()]), configStr);
    if (configStr && !(await configIsFixed())) {
        try {
            return await configDeserialize(configStr);
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        catch (_err) {
            // Do nothing
        }
    }
    return Value.Create(AddonConfig);
});