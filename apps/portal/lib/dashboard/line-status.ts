"use client";

import { createContext, useContext } from "react";

export type LinePhase = "connecting" | "ready" | "incoming" | "in-call" | "error";
export type LineStatus = "up" | "down";

export function lineStatusFromPhase(phase: LinePhase): LineStatus {
  return phase === "ready" || phase === "incoming" || phase === "in-call" ? "up" : "down";
}

/** Softphone pushes its phase here; the greeting beacon reads it. Default no-op
 *  so the shared softphone works in layouts without a provider (admin). */
export const LineStatusContext = createContext<{
  status: LineStatus;
  report: (phase: LinePhase) => void;
}>({ status: "down", report: () => {} });

export function useLineStatus() {
  return useContext(LineStatusContext);
}
