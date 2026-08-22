ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mvc_balance integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.get_credit_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  w record;
  r record;
  rule record;
  pools jsonb := '[]'::jsonb;
  rates jsonb := '[]'::jsonb;
  used int;
  v_wallet int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO w FROM public.quota_window(v_user);
  SELECT COALESCE(mvc_balance,0) INTO v_wallet FROM public.profiles WHERE id = v_user;
  v_wallet := COALESCE(v_wallet, 0);

  IF w.tier = 'free' THEN
    FOR r IN SELECT unnest(ARRAY['photo','video']) AS kind LOOP
      SELECT * INTO rule FROM public.credit_rule(w.tier, r.kind, '720p');
      SELECT COALESCE(used_count,0) INTO used FROM public.quota_usage
        WHERE user_id = v_user AND bucket = rule.bucket AND period_start = w.period_start;
      used := COALESCE(used,0);
      pools := pools || jsonb_build_object(
        'key', r.kind, 'kind', r.kind, 'limit', rule.pool_max,
        'used', used, 'remaining', GREATEST(rule.pool_max - used, 0));
    END LOOP;
  ELSE
    SELECT * INTO rule FROM public.credit_rule(w.tier, 'photo', '720p');
    SELECT COALESCE(used_count,0) INTO used FROM public.quota_usage
      WHERE user_id = v_user AND bucket = 'credits' AND period_start = w.period_start;
    used := COALESCE(used,0);
    pools := pools || jsonb_build_object(
      'key', 'credits', 'kind', 'all', 'limit', rule.pool_max,
      'used', used, 'remaining', GREATEST(rule.pool_max - used, 0));
  END IF;

  FOR r IN
    SELECT k.kind, res.resolution
    FROM (VALUES ('photo'),('video')) AS k(kind)
    CROSS JOIN (VALUES ('720p'),('1080p'),('2K'),('4K')) AS res(resolution)
  LOOP
    SELECT * INTO rule FROM public.credit_rule(w.tier, r.kind, r.resolution);
    rates := rates || jsonb_build_object(
      'kind', r.kind, 'resolution', r.resolution,
      'locked', rule.cost IS NULL, 'cost', rule.cost);
  END LOOP;

  RETURN jsonb_build_object(
    'tier', w.tier,
    'server_time', now(),
    'period_start', w.period_start,
    'period_end', w.period_end,
    'mvc_balance', v_wallet,
    'pools', pools,
    'rates', rates
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_mvc(p_kind text, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  w record;
  rule record;
  v_used int;
  v_pool_left int;
  v_wallet int;
  v_from_pool int;
  v_from_wallet int;
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

  SELECT COALESCE(mvc_balance,0) INTO v_wallet FROM public.profiles WHERE id = v_user FOR UPDATE;
  v_wallet := COALESCE(v_wallet, 0);
  v_pool_left := GREATEST(rule.pool_max - v_used, 0);

  IF v_pool_left + v_wallet < p_amount THEN
    RETURN jsonb_build_object('success', false, 'reason', 'INSUFFICIENT_CREDITS', 'tier', w.tier,
                              'cost', p_amount, 'limit', rule.pool_max,
                              'remaining', v_pool_left, 'mvc_balance', v_wallet);
  END IF;

  v_from_pool := LEAST(v_pool_left, p_amount);
  v_from_wallet := p_amount - v_from_pool;

  IF v_from_pool > 0 THEN
    UPDATE public.quota_usage SET used_count = used_count + v_from_pool
      WHERE user_id = v_user AND bucket = rule.bucket AND period_start = w.period_start
      RETURNING used_count INTO v_used;
  END IF;

  IF v_from_wallet > 0 THEN
    UPDATE public.profiles SET mvc_balance = GREATEST(mvc_balance - v_from_wallet, 0)
      WHERE id = v_user RETURNING mvc_balance INTO v_wallet;
  END IF;

  RETURN jsonb_build_object('success', true, 'tier', w.tier, 'cost', p_amount,
                            'limit', rule.pool_max, 'used', v_used,
                            'mvc_balance', v_wallet,
                            'remaining', GREATEST(rule.pool_max - v_used, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_inject_mvc(p_email text, p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_email text;
  v_target uuid;
  v_balance int;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT lower(email) INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS DISTINCT FROM 'tyozxtar@gmail.com' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 OR p_amount < -1000 OR p_amount > 1000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT id INTO v_target FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'USER_NOT_FOUND');
  END IF;

  INSERT INTO public.profiles (id, email)
    VALUES (v_target, lower(trim(p_email)))
    ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles
    SET mvc_balance = GREATEST(COALESCE(mvc_balance,0) + p_amount, 0)
    WHERE id = v_target
    RETURNING mvc_balance INTO v_balance;

  RETURN jsonb_build_object('success', true, 'email', lower(trim(p_email)), 'mvc_balance', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_inject_mvc(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_inject_mvc(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_credit_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_mvc(text, integer) TO authenticated;