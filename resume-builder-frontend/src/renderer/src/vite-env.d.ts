/// <reference types="vite/client" />

import type { AiProfilesApi } from "../../shared/ai-profiles"
import type { WebAuthApi } from "../../shared/auth"

declare global {
  const __APP_VERSION__: string

  interface Window {
    aiProfiles: AiProfilesApi
    webAuth: WebAuthApi
  }

  const chrome: {
    storage?: { local?: unknown }
    tabs?: {
      query: (queryInfo: { active?: boolean; currentWindow?: boolean }) => Promise<Array<{ id?: number }>>
      onActivated?: { addListener: (listener: (activeInfo: { tabId: number }) => void) => void; removeListener: (listener: (activeInfo: { tabId: number }) => void) => void }
    }
  }
}

export {}
