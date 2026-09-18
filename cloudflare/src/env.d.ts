// Bindings that are not in wrangler.jsonc vars: secrets set with `wrangler secret put`, and optional vars.
interface Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_ENCRYPTION_KEY?: string;
}
