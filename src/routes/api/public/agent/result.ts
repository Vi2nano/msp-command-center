import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { deviceFromRequest, json } from "@/lib/agent.server";

const Body = z.object({
  run_id: z.string().uuid(),
  exit_code: z.number().int(),
  output: z.string().max(200_000),
});

export const Route = createFileRoute("/api/public/agent/result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const device = await deviceFromRequest(request);
        if (!device) return json({ error: "unauthorized" }, 401);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid body" }, 400);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("script_runs").update({
          status: parsed.data.exit_code === 0 ? "completed" : "failed",
          exit_code: parsed.data.exit_code,
          output: parsed.data.output,
          completed_at: new Date().toISOString(),
        }).eq("id", parsed.data.run_id).eq("device_id", device.id);
        if (error) return json({ error: "update failed" }, 500);
        return json({ ok: true });
      },
    },
  },
});
