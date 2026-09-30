import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { deviceFromRequest, json } from "@/lib/agent.server";

const Body = z.object({
  cpu_percent: z.number().min(0).max(100),
  memory_percent: z.number().min(0).max(100),
  disk_percent: z.number().min(0).max(100),
  patches_pending: z.number().int().min(0).max(10000).optional(),
  ip_address: z.string().max(64).optional(),
  os: z.string().max(255).optional(),
  uptime_seconds: z.number().int().min(0).optional(),
  agent_version: z.string().max(32).optional(),
});

async function raise(admin: any, device: { id: string; tenant_id: string; hostname: string }, key: string, severity: "critical" | "warning", title: string, active: boolean) {
  const fullTitle = `${device.hostname}: ${title}`;
  const { data: open } = await admin.from("alerts").select("id").eq("device_id", device.id)
    .eq("title", fullTitle).neq("state", "resolved").maybeSingle();
  if (active && !open) {
    await admin.from("alerts").insert({ tenant_id: device.tenant_id, device_id: device.id, severity, title: fullTitle, detail: key });
  } else if (!active && open) {
    await admin.from("alerts").update({ state: "resolved" }).eq("id", open.id);
  }
}

export const Route = createFileRoute("/api/public/agent/checkin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const device = await deviceFromRequest(request);
        if (!device) return json({ error: "unauthorized" }, 401);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid body" }, 400);
        const m = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as { cpu_percent: number; memory_percent: number; disk_percent: number } & Record<string, string | number>;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const hot = m.cpu_percent > 95 || m.memory_percent > 95 || m.disk_percent > 90;
        await supabaseAdmin.from("devices").update({
          ...m, status: hot ? "warning" : "online", last_seen: new Date().toISOString(),
        }).eq("id", device.id);

        await raise(supabaseAdmin, device, "disk", "critical", "Disk above 90%", m.disk_percent > 90);
        await raise(supabaseAdmin, device, "memory", "warning", "Memory above 95%", m.memory_percent > 95);

        // Hand out queued scripts (max 5 per check-in) and mark them running.
        const { data: jobs } = await supabaseAdmin.from("script_runs")
          .select("id, script_name, body").eq("device_id", device.id).eq("status", "queued")
          .order("created_at").limit(5);
        if (jobs?.length) {
          await supabaseAdmin.from("script_runs")
            .update({ status: "running", started_at: new Date().toISOString() })
            .in("id", jobs.map((j) => j.id));
        }
        return json({ jobs: jobs ?? [], next_checkin_seconds: 60 });
      },
    },
  },
});
