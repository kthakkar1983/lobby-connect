"use client";

/**
 * One off-duty prompt for the whole shell (spec §3.4, D8) — not one dialog per
 * gated button.
 *
 * Gated controls stay ENABLED and focusable. A `disabled` button fires no click
 * event, so it cannot be intercepted; it also gives touch users no feedback at
 * all and is low-contrast for everyone. Keeping the control live and answering
 * on use is both the only way to build this and the better a11y outcome.
 *
 * PRESENTATION ONLY. The authoritative gates stay exactly where they are —
 * softphone.tsx's `if (!canWorkRef.current) return;` accept gate and the
 * server-side D13 duty check. This guard must NEVER become the only thing
 * preventing an off-duty action.
 *
 * DUTY-SPECIFIC, not a blanket disabled-handler: only the duty reason routes
 * here. Real unavailability (an offline kiosk, an in-flight request) stays
 * genuinely `disabled` at the call site — offering "start your shift" for an
 * offline kiosk would be a lie, since starting the shift would not fix it.
 *
 * Mounted in app-shell.tsx inside DutyProvider. It is a plain context provider
 * by requirement: the shell carries an invariant that no React.memo or Suspense
 * boundary may sit between DutyProvider and the softphone, so this must not be
 * memoized or suspended.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDutyOptional } from "@/components/dashboard/duty-provider";

type PromptCtx = { readonly prompt: () => void };

const Ctx = createContext<PromptCtx | null>(null);

export function OffDutyPromptProvider({ children }: { readonly children: React.ReactNode }) {
  const duty = useDutyOptional();
  const [open, setOpen] = useState(false);

  // Stable for the provider's lifetime: `setOpen` is stable, so no consumer is
  // re-rendered merely because this provider re-rendered.
  const value = useMemo<PromptCtx>(() => ({ prompt: () => setOpen(true) }), []);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>You&apos;re off duty</AlertDialogTitle>
            <AlertDialogDescription>
              That isn&apos;t available until your shift starts. Would you like to start it now?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void duty?.goOnDuty();
              }}
            >
              Start my shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

/**
 * Gate an action on duty. `gated` is for styling only; `guard` is what actually
 * withholds the action.
 *
 * Safe with either provider absent — `useDutyOptional()` returns null outside
 * DutyProvider (nothing to gate), and `prompt` is optional-chained so a gated
 * click outside OffDutyPromptProvider still blocks rather than throwing.
 * tests/components/call-tile-manager.test.tsx mounts PropertyCard with neither.
 */
export function useDutyGuard(): {
  readonly gated: boolean;
  readonly guard: (run: () => void) => void;
} {
  const duty = useDutyOptional();
  const ctx = useContext(Ctx);
  const gated = duty != null && !duty.canWork;

  const guard = useCallback(
    (run: () => void) => {
      if (gated) {
        ctx?.prompt();
        return;
      }
      run();
    },
    [gated, ctx],
  );

  return useMemo(() => ({ gated, guard }), [gated, guard]);
}
