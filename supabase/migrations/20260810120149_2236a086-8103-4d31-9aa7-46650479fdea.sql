CREATE OR REPLACE FUNCTION public.claim_voucher(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_voucher public.vouchers%ROWTYPE;
  v_new_until TIMESTAMPTZ;
  v_current_until TIMESTAMPTZ;
  v_points INT;
  v_total INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_voucher FROM public.vouchers WHERE code = upper(trim(p_code)) FOR UPDATE;

  IF NOT FOUND OR v_voucher.is_used THEN
    RAISE EXCEPTION 'INVALID_OR_USED';
  END IF;

  INSERT INTO public.profiles (id, email)
    SELECT v_user, (SELECT email FROM auth.users WHERE id = v_user)
    ON CONFLICT (id) DO NOTHING;

  SELECT premium_until INTO v_current_until FROM public.profiles WHERE id = v_user;
  v_current_until := GREATEST(COALESCE(v_current_until, now()), now());

  IF v_voucher.package_type = 'monthly' THEN
    v_new_until := v_current_until + INTERVAL '30 days';
    v_points := 2;
  ELSIF v_voucher.package_type = 'yearly_vip' THEN
    v_new_until := v_current_until + INTERVAL '365 days';
    v_points := 5;
  ELSE
    v_new_until := v_current_until + INTERVAL '365 days';
    v_points := 3;
  END IF;

  UPDATE public.vouchers SET is_used = true, used_by = v_user, used_at = now() WHERE id = v_voucher.id;

  UPDATE public.profiles
     SET is_premium = true,
         premium_until = v_new_until,
         package_type = v_voucher.package_type,
         premium_started_at = COALESCE(premium_started_at, now()),
         total_mvp_points = COALESCE(total_mvp_points, 0) + v_points,
         email = COALESCE(email, (SELECT email FROM auth.users WHERE id = v_user)),
         updated_at = now()
   WHERE id = v_user
   RETURNING total_mvp_points INTO v_total;

  RETURN jsonb_build_object('success', true, 'package_type', v_voucher.package_type,
                            'premium_until', v_new_until, 'mvp_added', v_points,
                            'total_mvp_points', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_leaderboard()
 RETURNS TABLE(display_name text, package_type text, mvp_points integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(NULLIF(p.display_name, ''), split_part(COALESCE(p.email, 'Pengguna'), '@', 1)) AS display_name,
         COALESCE(p.package_type, 'monthly') AS package_type,
         p.total_mvp_points AS mvp_points
  FROM public.profiles p
  WHERE p.total_mvp_points > 0
  ORDER BY p.total_mvp_points DESC
  LIMIT 100
$function$;

REVOKE EXECUTE ON FUNCTION public.get_leaderboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard() TO authenticated;