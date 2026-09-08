REVOKE ALL ON FUNCTION public.consume_mvc(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_inject_mvc(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_mvc(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_inject_mvc(text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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
  THEN
    RAISE EXCEPTION 'Not allowed to modify premium or credit fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns_trg ON public.profiles;
CREATE TRIGGER profiles_guard_privileged_columns_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_privileged_columns();

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (display_name, email, updated_at) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;