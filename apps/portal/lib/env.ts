function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in apps/portal/.env.local (see .env.example).`,
    );
  }
  return value;
}

function optional(value: string | undefined): string | undefined {
  if (!value || value.length === 0) return undefined;
  return value;
}

export const env = {
  // Public — exposed to browser bundle. Safe to ship.
  NEXT_PUBLIC_SUPABASE_URL: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),

  // Server-only — never exposed. Read inside route handlers / server modules.
  SUPABASE_SERVICE_ROLE_KEY: required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ),

  NEXT_PUBLIC_APP_URL: optional(process.env.NEXT_PUBLIC_APP_URL),
} as const;

export type Env = typeof env;
