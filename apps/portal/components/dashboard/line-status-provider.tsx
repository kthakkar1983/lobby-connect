"use client";

import { useCallback, useMemo, useState } from "react";
import {
  LineStatusContext,
  lineStatusFromPhase,
  type LinePhase,
  type LineStatus,
} from "@/lib/dashboard/line-status";

export function LineStatusProvider({ children }: { readonly children: React.ReactNode }) {
  const [status, setStatus] = useState<LineStatus>("down");
  const report = useCallback((phase: LinePhase) => setStatus(lineStatusFromPhase(phase)), []);
  const value = useMemo(() => ({ status, report }), [status, report]);
  return <LineStatusContext.Provider value={value}>{children}</LineStatusContext.Provider>;
}
