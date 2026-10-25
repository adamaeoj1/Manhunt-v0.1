import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupabaseCredentials(): { url: string; key: string } | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (
    !url ||
    !key ||
    !url.startsWith('https://') ||
    url.includes('your-project-ref') ||
    key.includes('your-supabase-service-role') ||
    key.includes('your-supabase-anon-key')
  ) {
    return null;
  }

  return { url, key };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseCredentials() !== null;
}

export function getSupabaseAdminClient(): SupabaseClient {
  const creds = getSupabaseCredentials();
  if (!creds) {
    throw new Error('Missing Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }

  return createClient(creds.url, creds.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
