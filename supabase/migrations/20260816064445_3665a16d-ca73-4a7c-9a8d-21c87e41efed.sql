CREATE OR REPLACE FUNCTION public.credit_rule(_tier text, _kind text, _resolution text)
 RETURNS TABLE(bucket text, pool_max integer, cost integer)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _tier = 'free' THEN
    bucket := _kind;
    IF _kind = 'photo' THEN
      pool_max := 5;
      cost := CASE WHEN _resolution IN ('720p','1080p') THEN 1 ELSE NULL END;
    ELSE
      pool_max := 9;
      cost := CASE WHEN _resolution = '720p' THEN 3 ELSE NULL END;
    END IF;
  ELSE
    bucket := 'credits';
    pool_max := CASE _tier
                  WHEN 'monthly' THEN 200
                  WHEN 'yearly' THEN 250
                  WHEN 'yearly_vip' THEN 400
                  ELSE 200 END;
    IF _kind = 'photo' THEN
      cost := CASE WHEN _resolution IN ('720p','1080p') THEN 1 ELSE 2 END;
    ELSE
      cost := CASE WHEN _resolution IN ('720p','1080p') THEN 5 ELSE 15 END;
    END IF;
  END IF;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_credits(p_kind text, p_resolution text)
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
  IF p_resolution NOT IN ('720p','1080p','2K','4K') THEN RAISE EXCEPTION 'INVALID_RESOLUTION'; END IF;

  SELECT * INTO w FROM public.quota_window(v_user);
  SELECT * INTO rule FROM public.credit_rule(w.tier, p_kind, p_resolution);

  IF rule.cost IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'LOCKED');
  END IF;

  UPDATE public.quota_usage
     SET used_count = GREATEST(used_count - rule.cost, 0)
   WHERE user_id = v_user AND bucket = rule.bucket AND period_start = w.period_start
   RETURNING used_count INTO v_used;

  IF v_used IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NO_USAGE_ROW');
  END IF;

  RETURN jsonb_build_object('success', true, 'refunded', rule.cost, 'used', v_used,
                            'remaining', GREATEST(rule.pool_max - v_used, 0), 'tier', w.tier);
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_credits(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_credits(text, text) TO authenticated, service_role;