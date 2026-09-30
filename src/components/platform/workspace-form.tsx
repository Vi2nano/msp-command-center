import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BILLING_MODES,
  contractedMonthly,
  money,
  slugify,
  type MspWorkspaceInput,
} from "@/lib/platform";

export function WorkspaceForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
}: {
  initial: MspWorkspaceInput;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (v: MspWorkspaceInput) => void;
}) {
  const [f, setF] = useState<MspWorkspaceInput>(initial);
  const [slugTouched, setSlugTouched] = useState(!!initial.slug);
  const num = (k: keyof MspWorkspaceInput, v: string) =>
    setF({ ...f, [k]: v === "" ? 0 : Math.max(0, Number(v)) });
  const total = contractedMonthly({
    contracted_seats: f.contracted_seats ?? 0,
    contracted_agents: f.contracted_agents ?? 0,
    price_per_seat: f.price_per_seat ?? 0,
    price_per_agent: f.price_per_agent ?? 0,
    flat_monthly_fee: f.flat_monthly_fee ?? 0,
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>MSP name</Label>
          <Input
            required
            value={f.name}
            onChange={(e) =>
              setF({
                ...f,
                name: e.target.value,
                slug: slugTouched ? f.slug : slugify(e.target.value),
              })
            }
          />
        </div>
        <div>
          <Label>Slug</Label>
          <Input
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={f.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setF({ ...f, slug: e.target.value });
            }}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Contracted seats</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={f.contracted_seats ?? 0}
            onChange={(e) => num("contracted_seats", e.target.value)}
          />
        </div>
        <div>
          <Label>Contracted agents</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={f.contracted_agents ?? 0}
            onChange={(e) => num("contracted_agents", e.target.value)}
          />
        </div>
        <div>
          <Label>Price per seat ($/mo)</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={f.price_per_seat ?? 0}
            onChange={(e) => num("price_per_seat", e.target.value)}
          />
        </div>
        <div>
          <Label>Price per agent ($/mo)</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={f.price_per_agent ?? 0}
            onChange={(e) => num("price_per_agent", e.target.value)}
          />
        </div>
        <div>
          <Label>Flat monthly fee ($)</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={f.flat_monthly_fee ?? 0}
            onChange={(e) => num("flat_monthly_fee", e.target.value)}
          />
        </div>
        <div>
          <Label>Billing mode</Label>
          <Select
            value={f.billing_mode ?? "manual_invoice"}
            onValueChange={(v) => setF({ ...f, billing_mode: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BILLING_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Billing notes</Label>
        <Textarea
          rows={3}
          value={f.billing_notes ?? ""}
          onChange={(e) => setF({ ...f, billing_notes: e.target.value })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Contracted monthly total: <span className="font-mono text-foreground">{money(total)}</span>{" "}
        (flat fee + seats × seat price + agents × agent price)
      </p>
      <Button type="submit" className="w-full" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
