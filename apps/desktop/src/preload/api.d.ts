import type { TwirlyApi } from '@shared/api'

declare global {
  interface Window {
    twirly: TwirlyApi
  }
}

export {}
