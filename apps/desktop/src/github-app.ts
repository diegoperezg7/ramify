// The Ramify Desktop GitHub App (github.com/apps/ramify-desktop). Its client id is public by design:
// the device flow has no secret. RAMIFY_GITHUB_CLIENT_ID / RAMIFY_GITHUB_APP_SLUG override it for development.
export const GITHUB_APP = {
  clientId: process.env.RAMIFY_GITHUB_CLIENT_ID || 'Iv23liod38OXQnJfENtP',
  slug: process.env.RAMIFY_GITHUB_APP_SLUG || 'ramify-desktop',
}
