CREATE OR REPLACE FUNCTION public.consume_mvc(p_kind text, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  w record;
  rule record;
  v_used int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_kind NOT IN ('photo','video') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 50 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  INSERT INTO public.profiles (id, email)
    SELECT v_user, (SELECT email FROM auth.users WHERE id = v_user)
    ON CONFLICT (id) DO NOTHING;

  SELECT * INTO w FROM public.quota_window(v_user);
  SELECT * INTO rule FROM public.credit_rule(w.tier, p_kind, '720p');

  INSERT INTO public.quota_usage (user_id, bucket, period_start, period_end, used_count)
  VALUES (v_user, rule.bucket, w.period_start, w.period_end, 0)
  ON CONFLICT (user_id, bucket, period_start) DO NOTHING;

  SELECT used_count INTO v_used FROM public.quota_usage
    WHERE user_id = v_user AND bucket = rule.bucket AND period_start = w.period_start
    FOR UPDATE;

  IF v_used + p_amount > rule.pool_max THEN
    RETURN jsonb_build_object('success', false, 'reason', 'INSUFFICIENT_CREDITS', 'tier', w.tier,
                              'cost', p_amount, 'limit', rule.pool_max,
                              'remaining', GREATEST(rule.pool_max - v_used, 0));
  END IF;

  UPDATE public.quota_usage SET used_count = used_count + p_amount
    WHERE user_id = v_user AND bucket = rule.bucket AND period_start = w.period_start
    RETURNING used_count INTO v_used;

  RETURN jsonb_build_object('success', true, 'tier', w.tier, 'cost', p_amount,
                            'limit', rule.pool_max, 'used', v_used,
                            'remaining', GREATEST(rule.pool_max - v_used, 0));
END;
$function$;