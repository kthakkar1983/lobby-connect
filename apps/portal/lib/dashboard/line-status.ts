"use client";

import { createContext, useContext } from "react";

export type LinePhase = "connecting" | "ready" | "incoming" | "in-call" | "error";
export type LineStatus = "up" | "down";

export function lineStatusFromPhase(phase: LinePhase): LineStatus {
  return phase === "ready" || phase === "incoming" || phase === "in-call" ? "up" : "down";
}

/** Softphone pushes its phase here; consumers read the derived `status` (up/down)
 *  or the raw `phase` (e.g. the off-home incoming-call toast). Default no-op so the
 *  shared softphone works in layouts without a provider. */
export const LineStatusContext = createContext<{
  status: LineStatus;
  phase: LinePhase;
  report: (phase: LinePhase) => void;
}>({ status: "down", phase: "connecting", report: () => {} });

export function useLineStatus() {
  return useContext(LineStatusContext);
}
