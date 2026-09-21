/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BRIDGE_URL?: string
  readonly VITE_CALLING_SHARED_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
