import { google } from '../google/provider'
import { whoop } from '../whoop/provider'
import type { ProviderId, StrapProvider } from './types'

/** Every band the app can link. Adding one is adding it here. */
export const PROVIDERS: StrapProvider[] = [whoop, google]

export function isProviderId(id: string | undefined): id is ProviderId {
  return PROVIDERS.some((p) => p.id === id)
}

export function getProvider(id: ProviderId): StrapProvider {
  const provider = PROVIDERS.find((p) => p.id === id)
  if (!provider) throw new Error(`unknown strap provider ${id}`)
  return provider
}
