// Parse `vercel env pull` style credentials files without leaking quote
// characters into the value. Quoted values are common, and the previous
// optional-quote regex left the closing quote behind, silently invalidating
// PAT/App credentials.
export function parseCredentialEnv(text) {
  const values = {};
  for (const line of String(text ?? '').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!value || value === '[SENSITIVE]') continue;
    values[match[1]] = value;
  }
  return values;
}
