/// <reference types="vite/client" />

import type { AiProfilesApi } from "../../shared/ai-profiles"
import type { WebAuthApi } from "../../shared/auth"

declare global {
  const __APP_VERSION__: string

  interface Window {
    aiProfiles: AiProfilesApi
    webAuth: WebAuthApi
  }
}

export {}
