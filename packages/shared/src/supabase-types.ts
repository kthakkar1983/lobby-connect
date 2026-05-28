// packages/shared/src/supabase-types.ts
//
// Hand-written types matching the shape of `supabase gen types typescript`.
// When a remote Supabase project is linked, regenerate this file via:
//   pnpm supabase gen types typescript --linked > packages/shared/src/supabase-types.ts
// Until then, keep this file in sync with supabase/migrations/*.sql by hand.

// =============================================================================
// String-union types for CHECK-constrained columns
// =============================================================================

export type Role = "AGENT" | "ADMIN" | "OWNER";
export type ProfileStatus = "AVAILABLE" | "ON_CALL" | "OFFLINE";
export type CallChannel = "AUDIO" | "VIDEO";
export type CallState =
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_ANSWER"
  | "FAILED";
export type ActorType = "USER" | "SYSTEM";

// =============================================================================
// Generic JSON helper (mirrors what gen types emits)
// =============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// =============================================================================
// Database — top-level type, mirrors `supabase gen types` shape
// =============================================================================

export type Database = {
  public: {
    Tables: {
      operators: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          operator_id: string;
          role: Role;
          full_name: string;
          email: string;
          twilio_identity: string | null;
          status: ProfileStatus;
          active: boolean;
          mfa_secret: string | null;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          operator_id: string;
          role: Role;
          full_name: string;
          email: string;
          twilio_identity?: string | null;
          status?: ProfileStatus;
          active?: boolean;
          mfa_secret?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          role?: Role;
          full_name?: string;
          email?: string;
          twilio_identity?: string | null;
          status?: ProfileStatus;
          active?: boolean;
          mfa_secret?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      properties: {
        Row: {
          id: string;
          operator_id: string;
          name: string;
          owner_user_id: string | null;
          timezone: string;
          routing_did: string | null;
          property_phone_number: string | null;
          after_hours_support_phone: string | null;
          playbook_pdf_url: string | null;
          playbook_version: number | null;
          logo_url: string | null;
          kiosk_welcome_message: string | null;
          kiosk_apology_message: string | null;
          geocoded_lat: number | null;
          geocoded_long: number | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          operator_id: string;
          name: string;
          owner_user_id?: string | null;
          timezone: string;
          routing_did?: string | null;
          property_phone_number?: string | null;
          after_hours_support_phone?: string | null;
          playbook_pdf_url?: string | null;
          playbook_version?: number | null;
          logo_url?: string | null;
          kiosk_welcome_message?: string | null;
          kiosk_apology_message?: string | null;
          geocoded_lat?: number | null;
          geocoded_long?: number | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          name?: string;
          owner_user_id?: string | null;
          timezone?: string;
          routing_did?: string | null;
          property_phone_number?: string | null;
          after_hours_support_phone?: string | null;
          playbook_pdf_url?: string | null;
          playbook_version?: number | null;
          logo_url?: string | null;
          kiosk_welcome_message?: string | null;
          kiosk_apology_message?: string | null;
          geocoded_lat?: number | null;
          geocoded_long?: number | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      property_assignments: {
        Row: {
          id: string;
          operator_id: string;
          property_id: string;
          primary_agent_id: string;
          backup_agent_id: string | null;
          effective_from: string;
          effective_until: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          operator_id: string;
          property_id: string;
          primary_agent_id: string;
          backup_agent_id?: string | null;
          effective_from?: string;
          effective_until?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          property_id?: string;
          primary_agent_id?: string;
          backup_agent_id?: string | null;
          effective_from?: string;
          effective_until?: string | null;
          created_at?: string;
        };
      };
      admin_call_availability: {
        Row: {
          profile_id: string;
          property_id: string;
          operator_id: string;
          accepting_calls: boolean;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          property_id: string;
          operator_id: string;
          accepting_calls?: boolean;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          property_id?: string;
          operator_id?: string;
          accepting_calls?: boolean;
          updated_at?: string;
        };
      };
      calls: {
        Row: {
          id: string;
          operator_id: string;
          property_id: string;
          channel: CallChannel;
          state: CallState;
          twilio_call_sid: string | null;
          agora_channel_name: string | null;
          caller_number: string | null;
          handled_by_user_id: string | null;
          room_number: string | null;
          ring_started_at: string;
          answered_at: string | null;
          ended_at: string | null;
          duration_seconds: number | null;
          recording_url: string | null;
          recording_sid: string | null;
          flagged_for_review: boolean;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          operator_id: string;
          property_id: string;
          channel: CallChannel;
          state: CallState;
          twilio_call_sid?: string | null;
          agora_channel_name?: string | null;
          caller_number?: string | null;
          handled_by_user_id?: string | null;
          room_number?: string | null;
          ring_started_at?: string;
          answered_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          recording_url?: string | null;
          recording_sid?: string | null;
          flagged_for_review?: boolean;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          property_id?: string;
          channel?: CallChannel;
          state?: CallState;
          twilio_call_sid?: string | null;
          agora_channel_name?: string | null;
          caller_number?: string | null;
          handled_by_user_id?: string | null;
          room_number?: string | null;
          ring_started_at?: string;
          answered_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          recording_url?: string | null;
          recording_sid?: string | null;
          flagged_for_review?: boolean;
          notes?: string | null;
          created_at?: string;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          operator_id: string;
          actor_user_id: string | null;
          actor_type: ActorType;
          action: string;
          entity_type: string;
          entity_id: string | null;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          operator_id: string;
          actor_user_id?: string | null;
          actor_type: ActorType;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          actor_user_id?: string | null;
          actor_type?: ActorType;
          action?: string;
          entity_type?: string;
          entity_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
      };
      operator_settings: {
        Row: {
          operator_id: string;
          key: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          operator_id: string;
          key: string;
          value: string;
          updated_at?: string;
        };
        Update: {
          operator_id?: string;
          key?: string;
          value?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

// =============================================================================
// Convenience aliases
// =============================================================================

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
