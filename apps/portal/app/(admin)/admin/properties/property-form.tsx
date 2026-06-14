"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import {
  PROPERTY_TIMEZONES,
  DEFAULT_TIMEZONE,
} from "@/lib/properties/timezones";
import {
  createPropertyAction,
  updatePropertyAction,
  type PropertyInput,
} from "./actions";

export type OwnerOption = { id: string; full_name: string };

export type PropertyRow = {
  id: string;
  name: string;
  timezone: string;
  owner_user_id: string | null;
  routing_did: string | null;
  property_phone_number: string | null;
  after_hours_support_phone: string | null;
  kiosk_welcome_message: string | null;
  kiosk_apology_message: string | null;
  active: boolean;
};

// shadcn Select disallows an empty-string value, so null owner uses a sentinel.
const NO_OWNER = "none";

type Props =
  | { mode: "create"; owners: OwnerOption[] }
  | { mode: "edit"; owners: OwnerOption[]; property: PropertyRow };

export function PropertyForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = props.mode === "edit" ? props.property : null;

  const [name, setName] = useState(initial?.name ?? "");
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? DEFAULT_TIMEZONE,
  );
  const [ownerId, setOwnerId] = useState(initial?.owner_user_id ?? NO_OWNER);
  const [routingDid, setRoutingDid] = useState(initial?.routing_did ?? "");
  const [propertyPhone, setPropertyPhone] = useState(
    initial?.property_phone_number ?? "",
  );
  const [afterHours, setAfterHours] = useState(
    initial?.after_hours_support_phone ?? "",
  );
  const [welcome, setWelcome] = useState(
    initial?.kiosk_welcome_message ?? "",
  );
  const [apology, setApology] = useState(
    initial?.kiosk_apology_message ?? "",
  );
  const [active, setActive] = useState(initial?.active ?? true);

  function buildInput(): PropertyInput {
    return {
      name,
      timezone,
      owner_user_id: ownerId === NO_OWNER ? null : ownerId,
      routing_did: routingDid,
      property_phone_number: propertyPhone,
      after_hours_support_phone: afterHours,
      kiosk_welcome_message: welcome,
      kiosk_apology_message: apology,
    };
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (props.mode === "create") {
        const result = await createPropertyAction(buildInput());
        if (result.ok) {
          toast.success("Property created");
          router.push(`/admin/properties/${result.id}` as Route);
        } else {
          setError(result.error);
        }
      } else {
        const result = await updatePropertyAction({
          ...buildInput(),
          propertyId: props.property.id,
          active,
        });
        if (result.ok) {
          toast.success("Property updated");
          router.refresh();
        } else {
          setError(result.error);
        }
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROPERTY_TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner">Owner</Label>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger id="owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_OWNER}>No owner</SelectItem>
              {props.owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="routing_did">Routing number (Twilio DID)</Label>
          <Input
            id="routing_did"
            value={routingDid}
            onChange={(e) => setRoutingDid(e.target.value)}
            placeholder="+15551234567"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="property_phone">Property phone number</Label>
          <Input
            id="property_phone"
            value={propertyPhone}
            onChange={(e) => setPropertyPhone(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="after_hours">After-hours support phone</Label>
          <Input
            id="after_hours"
            value={afterHours}
            onChange={(e) => setAfterHours(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="welcome">Kiosk welcome message</Label>
        <Textarea
          id="welcome"
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          placeholder="How can we help?"
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="apology">Kiosk apology message</Label>
        <Textarea
          id="apology"
          value={apology}
          onChange={(e) => setApology(e.target.value)}
          rows={3}
        />
      </div>

      {props.mode === "edit" ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
          <Label htmlFor="active" className="flex flex-col gap-0.5">
            <span>Active</span>
            <span className="text-xs text-text-muted">
              Inactive properties are hidden from routing and assignments.
            </span>
          </Label>
          <Switch id="active" checked={active} onCheckedChange={setActive} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : props.mode === "create"
              ? "Create property"
              : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/admin/properties")}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
