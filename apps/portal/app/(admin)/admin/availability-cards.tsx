"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setCallAvailabilityAction } from "./properties/actions";

export function AvailabilityToggle({
  propertyId,
  propertyName,
  initial,
}: {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly initial: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [, startTransition] = useTransition();

  function toggle(next: boolean) {
    setOn(next);
    startTransition(async () => {
      const result = await setCallAvailabilityAction(propertyId, next);
      if (!result.ok) {
        setOn(!next);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-foreground">Covering</span>
      <Switch
        checked={on}
        onCheckedChange={toggle}
        aria-label={`Covering — ${propertyName}`}
      />
    </div>
  );
}
