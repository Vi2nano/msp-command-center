import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, sha256 } from "@/lib/agent.server";

const Body = z.object({
  enrollment_key: z.string().min(16).max(64),
  hostname: z.string().min(1).max(255),
  os: z.string().max(255).optional(),
  device_type: z.enum(["workstation", "server", "laptop"]).optional(),
  ip_address: z.string().max(64).optional(),
  external_id: z.string().max(128).optional(),
});

export const Route = createFileRoute("/api/public/agent/enroll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid body" }, 400);
        const b = parsed.data;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: tenant } = await supabaseAdmin
          .from("tenants").select("id").eq("enrollment_key", b.enrollment_key).maybeSingle();
        if (!tenant) return json({ error: "invalid enrollment key" }, 401);

        const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        const hash = await sha256(token);
        const fields = {
          hostname: b.hostname, os: b.os ?? null, device_type: b.device_type ?? "workstation",
          ip_address: b.ip_address ?? null, agent_token_hash: hash, source: "agent",
          status: "online" as const, last_seen: new Date().toISOString(),
        };
        // Re-enrollment of the same machine (by hardware id) replaces its token.
        let deviceId: string | undefined;
        if (b.external_id) {
          const { data: existing } = await supabaseAdmin.from("devices").select("id")
            .eq("tenant_id", tenant.id).eq("external_id", b.external_id).maybeSingle();
          if (existing) {
            await supabaseAdmin.from("devices").update(fields).eq("id", existing.id);
            deviceId = existing.id;
          }
        }
        if (!deviceId) {
          const { data, error } = await supabaseAdmin.from("devices")
            .insert({ ...fields, tenant_id: tenant.id, external_id: b.external_id ?? null })
            .select("id").single();
          if (error) return json({ error: "enroll failed" }, 500);
          deviceId = data.id;
        }
        return json({ device_id: deviceId, token });
      },
    },
  },
});
