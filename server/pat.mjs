// One server-side PAT resolver for both storage paths: the config.json value
// set from the UI, and GITHUB_TOKEN injected from credentials.env at boot.
// Callers only ever need the value or its presence; never log or return it.

export function serverPatFrom(config, environment = process.env) {
  const stored = typeof config?.github?.token === 'string' ? config.github.token.trim() : '';
  if (stored) return stored;
  return typeof environment.GITHUB_TOKEN === 'string' ? environment.GITHUB_TOKEN.trim() : '';
}

export function hasServerPat(config, environment = process.env) {
  return Boolean(serverPatFrom(config, environment));
}
