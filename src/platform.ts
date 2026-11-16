import { Capacitor } from '@capacitor/core'
import { publicAppBase } from './publicAppBase'

export const isNativeApp = Capacitor.isNativePlatform()

/** Shared links must open the website, never capacitor://localhost. */
export function publicAppUrl() {
  return publicAppBase(isNativeApp, location.origin, import.meta.env.VITE_PUBLIC_APP_URL)
}
