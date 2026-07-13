// packages/shared/src/supabase-types.ts
//
// Curated overlay over the machine-generated DB structure (database.generated.ts,
// produced by `pnpm gen:types`). The generator types CHECK-constrained text
// columns as plain `string`; this overlay re-narrows them to the curated unions
// the app relies on, using type-fest's MergeDeep (the Supabase-documented pattern).
// Regenerate the base with `pnpm gen:types`; the drift check enforces it in CI.
import type { MergeDeep } from "type-fest";
import type { Database as Generated } from "./database.generated";

// =============================================================================
// String-union types for CHECK-constrained columns
// =============================================================================
export type Role = "AGENT" | "ADMIN" | "OWNER";
export type ProfileStatus = "AVAILABLE" | "ON_CALL" | "AWAY" | "BREAK" | "OFFLINE";
export type ShiftEndedReason = "manual" | "lapsed" | "capped";
export type CallChannel = "AUDIO" | "VIDEO";
export type CallState =
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_ANSWER"
  | "FAILED";
export type ActorType = "USER" | "SYSTEM";
export type IncidentSeverity = "HIGH";
export type IncidentKind = "EMERGENCY_911";
export type IncidentStatus = "OPEN" | "RESOLVED";
export type KioskCtaStyle = "warm" | "accent" | "classic";

// =============================================================================
// Database — generated structure with curated column overrides
// =============================================================================
// MergeDeep re-narrows only the CHECK-constrained columns the generator widened
// to `string`. Every other table/column (and the graphql_public schema) passes
// through from the generated base unchanged.
type ColumnOverrides = {
  public: {
    Tables: {
      profiles: {
        Row: { role: Role; status: ProfileStatus };
        Insert: { role: Role; status?: ProfileStatus };
        Update: { role?: Role; status?: ProfileStatus };
      };
      calls: {
        Row: { channel: CallChannel; state: CallState };
        Insert: { channel: CallChannel; state: CallState };
        Update: { channel?: CallChannel; state?: CallState };
      };
      audit_logs: {
        Row: { actor_type: ActorType };
        Insert: { actor_type?: ActorType };
        Update: { actor_type?: ActorType };
      };
      incidents: {
        Row: {
          severity: IncidentSeverity;
          kind: IncidentKind;
          status: IncidentStatus;
        };
        Insert: {
          severity?: IncidentSeverity;
          kind?: IncidentKind;
          status?: IncidentStatus;
        };
        Update: {
          severity?: IncidentSeverity;
          kind?: IncidentKind;
          status?: IncidentStatus;
        };
      };
      properties: {
        Row: { kiosk_cta_style: KioskCtaStyle };
        Insert: { kiosk_cta_style?: KioskCtaStyle };
        Update: { kiosk_cta_style?: KioskCtaStyle };
      };
      shifts: {
        Row: { ended_reason: ShiftEndedReason | null };
        Insert: { ended_reason?: ShiftEndedReason | null };
        Update: { ended_reason?: ShiftEndedReason | null };
      };
    };
  };
};

export type Database = MergeDeep<Generated, ColumnOverrides>;

export type { Json } from "./database.generated";

// =============================================================================
// Convenience aliases (unchanged public surface)
// =============================================================================
// Defined over the MERGED Database (not the generated helpers) so the curated
// column narrowing flows through to every consumer.
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

// Named row aliases for ergonomic imports across the app
export type Operator = Tables<"operators">;
export type Profile = Tables<"profiles">;
export type Property = Tables<"properties">;
export type PropertyAssignment = Tables<"property_assignments">;
export type AdminCallAvailability = Tables<"admin_call_availability">;
export type Call = Tables<"calls">;
export type AuditLog = Tables<"audit_logs">;
export type OperatorSettings = Tables<"operator_settings">;
export type Shift = Tables<"shifts">;
export type ShiftBreak = Tables<"shift_breaks">;
