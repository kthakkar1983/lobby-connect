"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { shouldRefresh } from "@/lib/ui/auto-refresh";

export function AutoRefresh({ intervalMs = 20_000 }: { readonly intervalMs?: number }) {
  const router = useRouter();
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    const refresh = () => {
      lastRefreshRef.current = Date.now();
      router.refresh();
    };
    const id = setInterval(refresh, intervalMs);
    // Debounce the focus refresh so rapid tab switching can't fire it repeatedly.
    const onFocus = () => {
      if (shouldRefresh(lastRefreshRef.current, Date.now())) refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, intervalMs]);
  return null;
}
