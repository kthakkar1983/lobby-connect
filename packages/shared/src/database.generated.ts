export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_call_availability: {
        Row: {
          accepting_calls: boolean;
          operator_id: string;
          profile_id: string;
          property_id: string;
          updated_at: string;
        };
        Insert: {
          accepting_calls?: boolean;
          operator_id: string;
          profile_id: string;
          property_id: string;
          updated_at?: string;
        };
        Update: {
          accepting_calls?: boolean;
          operator_id?: string;
          profile_id?: string;
          property_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_call_availability_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_call_availability_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_call_availability_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_type: string;
          actor_user_id: string | null;
          created_at: string;
          details: Json | null;
          entity_id: string | null;
          entity_type: string;
          id: string;
          operator_id: string;
        };
        Insert: {
          action: string;
          actor_type: string;
          actor_user_id?: string | null;
          created_at?: string;
          details?: Json | null;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          operator_id: string;
        };
        Update: {
          action?: string;
          actor_type?: string;
          actor_user_id?: string | null;
          created_at?: string;
          details?: Json | null;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          operator_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      calls: {
        Row: {
          agora_channel_name: string | null;
          answered_at: string | null;
          caller_number: string | null;
          channel: string;
          created_at: string;
          duration_seconds: number | null;
          emergency_agent_call_sid: string | null;
          emergency_conference_name: string | null;
          ended_at: string | null;
          flagged_for_review: boolean;
          handled_by_user_id: string | null;
          id: string;
          notes: string | null;
          operator_id: string;
          property_id: string;
          recording_sid: string | null;
          recording_url: string | null;
          ring_started_at: string;
          room_number: string | null;
          state: string;
          twilio_call_sid: string | null;
        };
        Insert: {
          agora_channel_name?: string | null;
          answered_at?: string | null;
          caller_number?: string | null;
          channel: string;
          created_at?: string;
          duration_seconds?: number | null;
          emergency_agent_call_sid?: string | null;
          emergency_conference_name?: string | null;
          ended_at?: string | null;
          flagged_for_review?: boolean;
          handled_by_user_id?: string | null;
          id?: string;
          notes?: string | null;
          operator_id: string;
          property_id: string;
          recording_sid?: string | null;
          recording_url?: string | null;
          ring_started_at?: string;
          room_number?: string | null;
          state: string;
          twilio_call_sid?: string | null;
        };
        Update: {
          agora_channel_name?: string | null;
          answered_at?: string | null;
          caller_number?: string | null;
          channel?: string;
          created_at?: string;
          duration_seconds?: number | null;
          emergency_agent_call_sid?: string | null;
          emergency_conference_name?: string | null;
          ended_at?: string | null;
          flagged_for_review?: boolean;
          handled_by_user_id?: string | null;
          id?: string;
          notes?: string | null;
          operator_id?: string;
          property_id?: string;
          recording_sid?: string | null;
          recording_url?: string | null;
          ring_started_at?: string;
          room_number?: string | null;
          state?: string;
          twilio_call_sid?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "calls_handled_by_user_id_fkey";
            columns: ["handled_by_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calls_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calls_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      health_signals: {
        Row: {
          details: Json | null;
          last_ok_at: string | null;
          operator_id: string;
          signal: string;
          updated_at: string;
        };
        Insert: {
          details?: Json | null;
          last_ok_at?: string | null;
          operator_id: string;
          signal: string;
          updated_at?: string;
        };
        Update: {
          details?: Json | null;
          last_ok_at?: string | null;
          operator_id?: string;
          signal?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "health_signals_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      incidents: {
        Row: {
          call_id: string | null;
          conference_name: string | null;
          conference_sid: string | null;
          created_at: string;
          dispatched_to: string;
          emergency_call_sid: string | null;
          id: string;
          kind: string;
          notes: string | null;
          operator_id: string;
          property_id: string;
          resolution_note: string | null;
          resolved_at: string | null;
          severity: string;
          status: string;
          triggered_by: string | null;
        };
        Insert: {
          call_id?: string | null;
          conference_name?: string | null;
          conference_sid?: string | null;
          created_at?: string;
          dispatched_to: string;
          emergency_call_sid?: string | null;
          id?: string;
          kind?: string;
          notes?: string | null;
          operator_id: string;
          property_id: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          severity?: string;
          status?: string;
          triggered_by?: string | null;
        };
        Update: {
          call_id?: string | null;
          conference_name?: string | null;
          conference_sid?: string | null;
          created_at?: string;
          dispatched_to?: string;
          emergency_call_sid?: string | null;
          id?: string;
          kind?: string;
          notes?: string | null;
          operator_id?: string;
          property_id?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          severity?: string;
          status?: string;
          triggered_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "incidents_call_id_fkey";
            columns: ["call_id"];
            isOneToOne: false;
            referencedRelation: "calls";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_triggered_by_fkey";
            columns: ["triggered_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      operator_settings: {
        Row: {
          key: string;
          operator_id: string;
          updated_at: string;
          value: string;
        };
        Insert: {
          key: string;
          operator_id: string;
          updated_at?: string;
          value: string;
        };
        Update: {
          key?: string;
          operator_id?: string;
          updated_at?: string;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operator_settings_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      operators: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          active: boolean;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          last_seen_at: string | null;
          mfa_secret: string | null;
          must_change_password: boolean;
          operator_id: string;
          role: string;
          status: string;
          twilio_identity: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email: string;
          full_name: string;
          id: string;
          last_seen_at?: string | null;
          mfa_secret?: string | null;
          must_change_password?: boolean;
          operator_id: string;
          role: string;
          status?: string;
          twilio_identity?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          last_seen_at?: string | null;
          mfa_secret?: string | null;
          must_change_password?: boolean;
          operator_id?: string;
          role?: string;
          status?: string;
          twilio_identity?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      properties: {
        Row: {
          active: boolean;
          after_hours_support_phone: string | null;
          created_at: string;
          geocoded_lat: number | null;
          geocoded_long: number | null;
          id: string;
          kiosk_apology_message: string | null;
          kiosk_breakfast_hours: string | null;
          kiosk_checkin_time: string | null;
          kiosk_checkout_time: string | null;
          kiosk_cta_style: string;
          kiosk_welcome_heading: string | null;
          kiosk_welcome_message: string | null;
          kiosk_wifi_network: string | null;
          kiosk_wifi_password: string | null;
          logo_url: string | null;
          name: string;
          operator_id: string;
          owner_user_id: string | null;
          playbook_pdf_url: string | null;
          playbook_version: number | null;
          property_phone_number: string | null;
          routing_did: string | null;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          after_hours_support_phone?: string | null;
          created_at?: string;
          geocoded_lat?: number | null;
          geocoded_long?: number | null;
          id?: string;
          kiosk_apology_message?: string | null;
          kiosk_breakfast_hours?: string | null;
          kiosk_checkin_time?: string | null;
          kiosk_checkout_time?: string | null;
          kiosk_cta_style?: string;
          kiosk_welcome_heading?: string | null;
          kiosk_welcome_message?: string | null;
          kiosk_wifi_network?: string | null;
          kiosk_wifi_password?: string | null;
          logo_url?: string | null;
          name: string;
          operator_id: string;
          owner_user_id?: string | null;
          playbook_pdf_url?: string | null;
          playbook_version?: number | null;
          property_phone_number?: string | null;
          routing_did?: string | null;
          timezone: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          after_hours_support_phone?: string | null;
          created_at?: string;
          geocoded_lat?: number | null;
          geocoded_long?: number | null;
          id?: string;
          kiosk_apology_message?: string | null;
          kiosk_breakfast_hours?: string | null;
          kiosk_checkin_time?: string | null;
          kiosk_checkout_time?: string | null;
          kiosk_cta_style?: string;
          kiosk_welcome_heading?: string | null;
          kiosk_welcome_message?: string | null;
          kiosk_wifi_network?: string | null;
          kiosk_wifi_password?: string | null;
          logo_url?: string | null;
          name?: string;
          operator_id?: string;
          owner_user_id?: string | null;
          playbook_pdf_url?: string | null;
          playbook_version?: number | null;
          property_phone_number?: string | null;
          routing_did?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "properties_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_owner_user_id_fkey";
            columns: ["owner_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      property_assignments: {
        Row: {
          backup_agent_id: string | null;
          created_at: string;
          effective_from: string;
          effective_until: string | null;
          id: string;
          operator_id: string;
          primary_agent_id: string;
          property_id: string;
        };
        Insert: {
          backup_agent_id?: string | null;
          created_at?: string;
          effective_from?: string;
          effective_until?: string | null;
          id?: string;
          operator_id: string;
          primary_agent_id: string;
          property_id: string;
        };
        Update: {
          backup_agent_id?: string | null;
          created_at?: string;
          effective_from?: string;
          effective_until?: string | null;
          id?: string;
          operator_id?: string;
          primary_agent_id?: string;
          property_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "property_assignments_backup_agent_id_fkey";
            columns: ["backup_agent_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_assignments_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_assignments_primary_agent_id_fkey";
            columns: ["primary_agent_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_assignments_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      property_remote_access: {
        Row: {
          created_at: string;
          id: string;
          operator_id: string;
          peer_id: string;
          property_id: string;
          unattended_password: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          operator_id: string;
          peer_id: string;
          property_id: string;
          unattended_password: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          operator_id?: string;
          peer_id?: string;
          property_id?: string;
          unattended_password?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "property_remote_access_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_remote_access_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: true;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_seen_at: string;
          operator_id: string;
          p256dh: string;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_seen_at?: string;
          operator_id: string;
          p256dh: string;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_seen_at?: string;
          operator_id?: string;
          p256dh?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shift_breaks: {
        Row: {
          created_at: string;
          ended_at: string | null;
          id: string;
          shift_id: string;
          started_at: string;
        };
        Insert: {
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          shift_id: string;
          started_at?: string;
        };
        Update: {
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          shift_id?: string;
          started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shift_breaks_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "shifts";
            referencedColumns: ["id"];
          },
        ];
      };
      shifts: {
        Row: {
          created_at: string;
          edited_at: string | null;
          edited_by: string | null;
          ended_at: string | null;
          ended_reason: string | null;
          id: string;
          operator_id: string;
          started_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          edited_at?: string | null;
          edited_by?: string | null;
          ended_at?: string | null;
          ended_reason?: string | null;
          id?: string;
          operator_id: string;
          started_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          edited_at?: string | null;
          edited_by?: string | null;
          ended_at?: string | null;
          ended_reason?: string | null;
          id?: string;
          operator_id?: string;
          started_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shifts_edited_by_fkey";
            columns: ["edited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shifts_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shifts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_user_operator_id: { Args: never; Returns: string };
      current_user_role: { Args: never; Returns: string };
      user_is_assigned_to_property: {
        Args: { prop_id: string };
        Returns: boolean;
      };
      user_owns_property: { Args: { prop_id: string }; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
