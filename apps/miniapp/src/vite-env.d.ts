/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'demo' → LocalApi (PGlite in a Web Worker); 'http' → HttpApi against VITE_API_URL. */
  readonly VITE_TARGET: 'demo' | 'http';
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
