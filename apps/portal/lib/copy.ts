/**
 * Lobby Connect — shared user-facing copy (Stage 3, spec §6).
 *
 * A light, plain-TS home for high-traffic strings so voice stays consistent
 * (Stage 0 §5: calm, warm, plain-spoken; honest + actionable; no codes; never
 * blame the user). NOT an i18n framework — deep page-specific strings stay
 * inline. The kiosk has its own tiny mirror (`apps/kiosk/src/lib/copy.ts`);
 * the two apps are separate build graphs, so a shared package isn't warranted.
 */

type EmptyCopy = { title: string; description: string };

export const copy = {
  /** Empty / zero-item states (spec §4.1). Forward-looking, never a dead "No X." */
  empty: {
    ownerHome: {
      title: "No properties yet",
      description: "Properties assigned to you will appear here.",
    },
    ownerCalls: {
      title: "No calls yet",
      description: "Calls to the front desk will show up here.",
    },
    ownerPropertyCalls: {
      title: "No calls yet",
      description: "This property's calls will show up here.",
    },
    ownerIncidents: {
      title: "No emergencies",
      description: "Active and resolved emergencies will appear here.",
    },
    agentProperties: {
      title: "No properties assigned",
      description: "An admin will assign the properties you cover.",
    },
    agentCalls: {
      title: "No calls yet",
      description: "Calls you answer tonight will appear here.",
    },
    adminUsers: {
      title: "No users yet",
      description: "Add your team to get started.",
    },
    adminProperties: {
      title: "No properties yet",
      description: "Add your first property to start routing calls.",
    },
    adminAudit: {
      title: "No activity yet",
      description: "Account activity will appear here as your team works.",
    },
  } satisfies Record<string, EmptyCopy>,

  /** Error surfaces (spec §4.2). Calm, never a dead end; recovery is always offered. */
  error: {
    global: {
      title: "Something went wrong",
      description:
        "This screen hit an unexpected error — it's been logged. Try again, or reload the page.",
    },
    segment: {
      title: "Couldn't load this",
      description: "Something went wrong loading this page. Try again.",
    },
  } satisfies Record<string, EmptyCopy>,

  /** Sign-in errors — migrated from lib/auth/sign-in-errors.ts (voice unchanged;
   *  the generic default is a deliberate security choice — don't reveal which
   *  field is wrong). `mapSignInError` reads from here. */
  auth: {
    rateLimit: "Too many attempts. Please wait a few minutes and try again.",
    notConfirmed:
      "Your account isn't fully set up yet. Please contact your administrator.",
    invalidCredentials: "Invalid email or password.",
  },

  // NOTE: the 911 confirm copy intentionally stays inline in softphone.tsx — it
  // is safety-critical, carries a specific warning box, and was tuned in Stage 2.
  // Centralizing it here risked regressing that wording, so it is not duplicated.
} as const;
