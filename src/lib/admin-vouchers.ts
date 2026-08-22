import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "tyozxtar@gmail.com";

type AuthenticatedContext = {
  claims: unknown;
  userId: string;
  supabase: {
    auth: {
      getUser: () => Promise<{
        data: { user: { email?: string | null } | null };
        error: unknown;
      }>;
    };
  };
};

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () =>
    Array.from({ length: 4 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join("");
  return `MV-${block()}-${block()}`;
}

function getClaimEmail(claims: unknown) {
  if (!claims || typeof claims !== "object") return "";
  const email = (claims as { email?: unknown }).email;
  return typeof email === "string" ? email.toLowerCase() : "";
}

async function getAuthenticatedEmail(context: AuthenticatedContext) {
  const claimEmail = getClaimEmail(context.claims);
  if (claimEmail) return claimEmail;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(context.userId);
  if (error) throw new Error("Unauthorized: Invalid user session");
  return data.user?.email?.toLowerCase() ?? "";
}

async function assertAdmin(context: AuthenticatedContext) {
  const email = await getAuthenticatedEmail(context);
  if (email !== ADMIN_EMAIL) {
    throw new Error("FORBIDDEN");
  }
  return email;
}

export type PackageType = "monthly" | "yearly" | "yearly_vip";

const PACKAGE_TYPES: PackageType[] = ["monthly", "yearly", "yearly_vip"];

export const PLAN_CREDITS: Record<PackageType, number> = {
  monthly: 200,
  yearly: 250,
  yearly_vip: 400,
};

export const generateVouchersFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { quantity: number; packageType: PackageType }) => {
      const quantity = Math.max(1, Math.min(100, Math.floor(input.quantity)));
      const packageType: PackageType = PACKAGE_TYPES.includes(input.packageType)
        ? input.packageType
        : "monthly";
      return { quantity, packageType };
    },
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context as AuthenticatedContext);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const rows = Array.from({ length: data.quantity }, () => ({
      code: randomCode(),
      package_type: data.packageType,
    }));

    const { data: inserted, error } = await supabaseAdmin
      .from("vouchers")
      .insert(rows)
      .select("id, code, package_type, is_used, created_at");

    if (error) throw new Error(error.message);
    return inserted ?? [];
  });


export const listVouchersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as AuthenticatedContext);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("vouchers")
      .select("id, code, package_type, is_used, used_by, used_at, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const checkIsAdminFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = await getAuthenticatedEmail(context as AuthenticatedContext);
    return { isAdmin: email === ADMIN_EMAIL, email: email ?? null };
  });

export const injectMvcFn = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; amount: number }) => ({
    email: String(input.email ?? "").trim().toLowerCase(),
    amount: Math.max(-1000, Math.min(1000, Math.floor(Number(input.amount) || 0))),
  }))
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      data,
      context,
    }): Promise<{ success: boolean; reason?: string; balance?: number }> => {
      await assertAdmin(context as AuthenticatedContext);
      if (!data.email || !data.amount) return { success: false, reason: "INVALID_INPUT" };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("id, mvc_balance")
        .ilike("email", data.email)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!profile) return { success: false, reason: "USER_NOT_FOUND" };

      const next = Math.max(0, Number(profile.mvc_balance ?? 0) + data.amount);
      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ mvc_balance: next })
        .eq("id", profile.id);
      if (upErr) throw new Error(upErr.message);

      return { success: true, balance: next };
    },
  );


export const listSubscribersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as AuthenticatedContext);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const nowIso = new Date().toISOString();

    // Get active premium profiles
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, display_name, is_premium, premium_until, package_type")
      .eq("is_premium", true)
      .gt("premium_until", nowIso)
      .order("premium_until", { ascending: true });
    if (pErr) throw new Error(pErr.message);

    const ids = (profiles ?? []).map((p) => p.id);

    // Fallback package via most recent used voucher per user
    const pkgMap = new Map<string, PackageType>();
    // Credits used in the current active window
    const usedMap = new Map<string, number>();

    if (ids.length) {
      const { data: vs, error: vErr } = await supabaseAdmin
        .from("vouchers")
        .select("used_by, package_type, used_at")
        .in("used_by", ids)
        .order("used_at", { ascending: false });
      if (vErr) throw new Error(vErr.message);
      for (const v of vs ?? []) {
        if (v.used_by && !pkgMap.has(v.used_by)) {
          pkgMap.set(v.used_by, v.package_type as PackageType);
        }
      }

      const { data: usage, error: uErr } = await supabaseAdmin
        .from("quota_usage")
        .select("user_id, used_count, period_end")
        .in("user_id", ids)
        .gt("period_end", nowIso);
      if (uErr) throw new Error(uErr.message);
      for (const u of usage ?? []) {
        usedMap.set(u.user_id, (usedMap.get(u.user_id) ?? 0) + (u.used_count ?? 0));
      }
    }

    return (profiles ?? []).map((p) => {
      const packageType: PackageType =
        (p.package_type as PackageType | null) ?? pkgMap.get(p.id) ?? "monthly";
      const total = PLAN_CREDITS[packageType] ?? PLAN_CREDITS.monthly;
      const used = usedMap.get(p.id) ?? 0;
      return {
        id: p.id,
        email: p.email,
        display_name: p.display_name,
        premium_until: p.premium_until,
        package_type: packageType,
        credits_total: total,
        credits_used: used,
        credits_remaining: Math.max(total - used, 0),
      };
    });
  });

