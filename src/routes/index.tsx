import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Bell, Building2, Monitor, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meridian RMM — Monitoring & PSA for MSPs" },
      { name: "description", content: "Monitor every endpoint, triage alerts and serve every client from one multi-tenant console, billed per seat." },
      { property: "og:title", content: "Meridian RMM — Monitoring & PSA for MSPs" },
      { property: "og:description", content: "Multi-tenant RMM/PSA console for managed service providers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: Monitor, t: "Device monitoring", d: "CPU, memory, disk and patch status for every endpoint." },
  { icon: Bell, t: "Alert triage", d: "Critical, warning and info alerts with acknowledge and resolve flows." },
  { icon: Building2, t: "Multi-tenant", d: "Each client organization is isolated, with its own portal login." },
  { icon: Users, t: "Per-seat plans", d: "Track seats and plan tier per client for simple billing." },
  { icon: ShieldCheck, t: "Role-based access", d: "MSP admins, technicians and client users see only what they should." },
  { icon: Activity, t: "Live NOC view", d: "Fleet health at a glance across every tenant you manage." },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-display text-lg font-semibold">
          <Activity className="h-5 w-5 text-primary" /> Meridian
        </div>
        <Button asChild size="sm"><Link to="/dashboard">Open console</Link></Button>
      </header>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-20">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">RMM + PSA for MSPs</p>
        <h1 className="mt-4 max-w-3xl font-display text-5xl font-bold leading-tight">
          Every client. Every endpoint. One console.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Meridian gives managed service providers a single pane of glass for monitoring, alerting and client
          management — sold per tenant and per seat.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild size="lg"><Link to="/auth">Get started</Link></Button>
          <Button asChild size="lg" variant="outline"><Link to="/dashboard">Sign in</Link></Button>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-px overflow-hidden rounded-lg border border-border bg-border px-0 sm:grid-cols-2 lg:grid-cols-3 mb-20">
        {features.map((f) => (
          <div key={f.t} className="bg-card p-6">
            <f.icon className="h-5 w-5 text-primary" />
            <h3 className="mt-3 font-display font-semibold">{f.t}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
