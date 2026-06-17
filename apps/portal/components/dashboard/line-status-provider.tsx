"use client";

import { useCallback, useMemo, useState } from "react";
import {
  LineStatusContext,
  lineStatusFromPhase,
  type LinePhase,
} from "@/lib/dashboard/line-status";

export function LineStatusProvider({ children }: { readonly children: React.ReactNode }) {
  const [phase, setPhase] = useState<LinePhase>("connecting");
  const report = useCallback((next: LinePhase) => setPhase(next), []);
  const value = useMemo(
    () => ({ status: lineStatusFromPhase(phase), phase, report }),
    [phase, report],
  );
  return <LineStatusContext.Provider value={value}>{children}</LineStatusContext.Provider>;
}
