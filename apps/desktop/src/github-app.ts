// The Ramify Desktop GitHub App. Its client id is public by design (device flow has no secret).
// RAMIFY_GITHUB_CLIENT_ID / RAMIFY_GITHUB_APP_SLUG override it for development.
export const GITHUB_APP = {
  clientId: process.env.RAMIFY_GITHUB_CLIENT_ID || '',
  slug: process.env.RAMIFY_GITHUB_APP_SLUG || '',
}
