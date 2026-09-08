-- 1) SECURITY DEFINER functions that no client should ever call directly.
REVOKE EXECUTE ON FUNCTION public.admin_inject_mvc(text, integer) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_quota(text, text) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_quota_status() FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_daily_credit(text) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.quota_window(uuid) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated, anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_inject_mvc(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_quota(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_quota_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_daily_credit(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.quota_window(uuid) TO service_role;

-- Functions the signed-in app legitimately needs keep EXECUTE but must not be
-- reachable anonymously.
REVOKE EXECUTE ON FUNCTION public.claim_voucher(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_credits(text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_credits(text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_mvc(text, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_credit_status() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_daily_counts_if_new_day() FROM anon, PUBLIC;

-- 2) profiles: no anonymous writes, and self-updates limited to safe columns.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLE public.profiles FROM anon;
GRANT SELECT ON TABLE public.profiles TO anon;

REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (display_name, email, updated_at) ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- 3) Belt-and-braces: the column guard also rejects privileged edits made by
-- any non-service role, even if a future grant is widened by mistake.
CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.is_premium IS DISTINCT FROM OLD.is_premium
     OR NEW.premium_until IS DISTINCT FROM OLD.premium_until
     OR NEW.premium_started_at IS DISTINCT FROM OLD.premium_started_at
     OR NEW.package_type IS DISTINCT FROM OLD.package_type
     OR NEW.mvc_balance IS DISTINCT FROM OLD.mvc_balance
     OR NEW.total_mvp_points IS DISTINCT FROM OLD.total_mvp_points
     OR NEW.daily_photo_count IS DISTINCT FROM OLD.daily_photo_count
     OR NEW.daily_video_count IS DISTINCT FROM OLD.daily_video_count
     OR NEW.weekly_video_count_premium IS DISTINCT FROM OLD.weekly_video_count_premium
     OR NEW.monthly_video_count_premium IS DISTINCT FROM OLD.monthly_video_count_premium
     OR NEW.last_active_server_date IS DISTINCT FROM OLD.last_active_server_date
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Not allowed to modify premium or credit fields';
  END IF;

  RETURN NEW;
END;
$$;