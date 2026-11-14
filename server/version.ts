import pkg from "../package.json" with { type: "json" };

/** Versi app dari package.json. */
export const APP_VERSION: string = pkg.version;
