// FILE: src/vite-env.d.ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Declares the shape of CSS module imports to TypeScript.
 */
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_ROOT_DOMAIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
