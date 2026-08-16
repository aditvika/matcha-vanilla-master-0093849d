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
      cost := CASE WHEN _resolution IN ('720p','1080p','2K') THEN 1 ELSE 2 END;
    ELSE
      cost := CASE WHEN _resolution IN ('720p','1080p') THEN 5 ELSE 15 END;
    END IF;
  END IF;
  RETURN NEXT;
END;
$function$;