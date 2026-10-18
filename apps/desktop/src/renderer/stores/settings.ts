import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings'

interface SettingsState {
  settings: Settings
  loaded: boolean
  update: (patch: SettingsPatch) => Promise<void>
}

/** Mirror of main-process settings; every window stays in sync through settings:changed. */
export const useSettings = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: async (patch) => {
    const next = await window.twirly.settings.set(patch)
    set({ settings: next })
  },
}))

/** Apply theme and accent to the document so CSS tokens follow settings. */
function applyAppearance(s: Settings) {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.style.setProperty('--color-accent', s.accent)
  root.style.setProperty('--color-accent-hover', `color-mix(in srgb, ${s.accent} 75%, white)`)
  root.dataset.animation = s.animation
}

if (typeof window !== 'undefined' && window.twirly) {
  void window.twirly.settings.get().then((s) => {
    useSettings.setState({ settings: s, loaded: true })
    applyAppearance(s)
  })
  window.twirly.settings.onChange((s) => {
    useSettings.setState({ settings: s })
    applyAppearance(s)
  })
}
