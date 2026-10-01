import { supabase } from "@/integrations/supabase/client";
import type { Database, Tables, TablesInsert } from "@/integrations/supabase/types";

/**
 * Platform (you → MSP) configuration. Unrelated to the MSP → client invoices in `invoices`/`tenants`.
 * All reads/writes below go through the browser client and are enforced by RLS / SECURITY DEFINER
 * functions that require the `super_admin` role.
 */
export type MspWorkspace = Tables<"msp_workspaces">;
export type MspWorkspaceInput = Pick<
  TablesInsert<"msp_workspaces">,
  | "name"
  | "slug"
  | "contracted_seats"
  | "contracted_agents"
  | "price_per_seat"
  | "price_per_agent"
  | "flat_monthly_fee"
  | "billing_mode"
  | "billing_notes"
  | "status"
  | "enforce_limits"
  | "suspended_reason"
>;
export type WorkspaceUsage =
  Database["public"]["Functions"]["platform_workspace_usage"]["Returns"][number];
export type WorkspaceMember =
  Database["public"]["Functions"]["platform_workspace_members"]["Returns"][number];

export const BILLING_MODES = [
  { value: "manual_invoice", label: "Manual invoice" },
  { value: "subscription", label: "Subscription" },
] as const;

export const emptyWorkspace: MspWorkspaceInput = {
  name: "",
  slug: "",
  contracted_seats: 0,
  contracted_agents: 0,
  price_per_seat: 0,
  price_per_agent: 0,
  flat_monthly_fee: 0,
  billing_mode: "manual_invoice",
  billing_notes: "",
  status: "active",
  enforce_limits: false,
  suspended_reason: "",
};

export const USAGE_LABELS = {
  seats: "Staff users (msp_admin + technician members) vs contracted seats",
  agents: "Devices enrolled with the Meridian agent vs contracted agents",
  devices: "All devices, including manual and RMM-synced records",
};

export const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Contracted monthly amount from the manually configured terms (not a Stripe amount). */
export function contractedMonthly(
  w: Pick<
    MspWorkspace,
    | "contracted_seats"
    | "contracted_agents"
    | "price_per_seat"
    | "price_per_agent"
    | "flat_monthly_fee"
  >,
) {
  return +(
    Number(w.flat_monthly_fee) +
    w.contracted_seats * Number(w.price_per_seat) +
    w.contracted_agents * Number(w.price_per_agent)
  ).toFixed(2);
}

export async function isSuperAdmin(userId: string) {
  const { data, error } = await supabase.rpc("is_super_admin", { _user_id: userId });
  if (error) return false;
  return data === true;
}

export async function fetchWorkspaces() {
  const { data, error } = await supabase.from("msp_workspaces").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function fetchWorkspace(id: string) {
  const { data, error } = await supabase
    .from("msp_workspaces")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchWorkspaceUsage() {
  const { data, error } = await supabase.rpc("platform_workspace_usage");
  if (error) throw error;
  return new Map((data ?? []).map((u) => [u.workspace_id, u]));
}

export async function fetchWorkspaceMembers(workspaceId: string) {
  const { data, error } = await supabase.rpc("platform_workspace_members", {
    _workspace_id: workspaceId,
  });
  if (error) throw error;
  return data ?? [];
}

function clean(input: MspWorkspaceInput): MspWorkspaceInput {
  return {
    ...input,
    name: input.name.trim(),
    slug: slugify(input.slug || input.name),
    billing_notes: input.billing_notes?.trim() || null,
  };
}

export async function createWorkspace(input: MspWorkspaceInput) {
  const { data, error } = await supabase
    .from("msp_workspaces")
    .insert(clean(input))
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateWorkspace(id: string, input: MspWorkspaceInput) {
  const { error } = await supabase.from("msp_workspaces").update(clean(input)).eq("id", id);
  if (error) throw error;
}

export async function assignWorkspaceMember(
  workspaceId: string,
  email: string,
  role: "msp_admin" | "technician",
) {
  const { error } = await supabase.rpc("platform_assign_workspace_member", {
    _workspace_id: workspaceId,
    _email: email,
    _role: role,
  });
  if (error) throw error;
}

export async function removeWorkspaceMember(workspaceId: string, userId: string) {
  const { error } = await supabase.rpc("platform_remove_workspace_member", {
    _workspace_id: workspaceId,
    _user_id: userId,
  });
  if (error) throw error;
}
