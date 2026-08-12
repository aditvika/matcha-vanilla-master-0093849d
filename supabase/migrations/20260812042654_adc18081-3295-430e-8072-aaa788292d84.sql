CREATE OR REPLACE FUNCTION public.get_leaderboard()
 RETURNS TABLE(display_name text, package_type text, mvp_points integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(NULLIF(trim(p.display_name), ''), 'Matcha User') AS display_name,
         COALESCE(p.package_type, 'monthly') AS package_type,
         p.total_mvp_points AS mvp_points
  FROM public.profiles p
  WHERE p.total_mvp_points > 0
  ORDER BY p.total_mvp_points DESC
  LIMIT 100
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''), 'Matcha User'))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

UPDATE public.profiles SET display_name = 'Matcha User' WHERE display_name IS NULL OR trim(display_name) = '';