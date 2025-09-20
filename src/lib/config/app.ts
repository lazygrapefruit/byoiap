import { Type, type Static } from '@sinclair/typebox';
import { AddonConfig } from './addon';

export const AppConfig = Type.Object({
    named: Type.Record(Type.Readonly(Type.String()), AddonConfig),
});
export type AppConfig = Static<typeof AppConfig>;