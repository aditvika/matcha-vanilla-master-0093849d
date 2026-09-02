import { supabase } from "@/integrations/supabase/client";

export class SessionExpiredError extends Error {
  constructor(message = "SESSION_EXPIRED") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/**
 * Guarantees a valid, non-expiring-soon access token before a server function
 * call. Heavy local rendering can block the auto-refresh timer for minutes, so
 * we proactively refresh instead of letting the request 401 mid-process.
 */
export async function ensureFreshSession(minSecondsLeft = 120): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new SessionExpiredError();

  let session = data.session;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = session?.expires_at ?? 0;

  if (!session || expiresAt - now < minSecondsLeft) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) throw new SessionExpiredError();
    session = refreshed.data.session;
  }

  if (!session?.access_token) throw new SessionExpiredError();
  return session.access_token;
}

export function isAuthError(error: unknown): boolean {
  if (error instanceof SessionExpiredError) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unauthorized|jwt|401|session/i.test(message);
}
