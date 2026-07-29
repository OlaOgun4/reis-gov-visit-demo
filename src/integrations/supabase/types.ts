export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          actor_id: string | null
          actor_name: string
          created_at: string
          event: string
          id: string
          record_ref: string | null
          status: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          event: string
          id?: string
          record_ref?: string | null
          status?: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          event?: string
          id?: string
          record_ref?: string | null
          status?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          created_at: string
          department_id: string | null
          expected_at: string
          host_id: string | null
          id: string
          notes: string | null
          organisation: string | null
          phone: string | null
          purpose: string
          reference: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          visitor_id: string | null
          visitor_name: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          expected_at?: string
          host_id?: string | null
          id?: string
          notes?: string | null
          organisation?: string | null
          phone?: string | null
          purpose?: string
          reference?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          visitor_id?: string | null
          visitor_name: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          expected_at?: string
          host_id?: string | null
          id?: string
          notes?: string | null
          organisation?: string | null
          phone?: string | null
          purpose?: string
          reference?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          visitor_id?: string | null
          visitor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      facility_config: {
        Row: {
          approval_workflow: string
          created_at: string
          facility_name: string
          id: string
          organisation_name: string
          overdue_grace_minutes: number
          retention_months: number
          updated_at: string
        }
        Insert: {
          approval_workflow?: string
          created_at?: string
          facility_name?: string
          id?: string
          organisation_name?: string
          overdue_grace_minutes?: number
          retention_months?: number
          updated_at?: string
        }
        Update: {
          approval_workflow?: string
          created_at?: string
          facility_name?: string
          id?: string
          organisation_name?: string
          overdue_grace_minutes?: number
          retention_months?: number
          updated_at?: string
        }
        Relationships: []
      }
      hosts: {
        Row: {
          active: boolean
          created_at: string
          department_id: string
          email: string | null
          full_name: string
          id: string
          job_title: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          department_id: string
          email?: string | null
          full_name: string
          id?: string
          job_title?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          department_id?: string
          email?: string | null
          full_name?: string
          id?: string
          job_title?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hosts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          department_id: string | null
          facility: string
          full_name: string
          id: string
          job_title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          facility?: string
          full_name?: string
          id: string
          job_title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          facility?: string
          full_name?: string
          id?: string
          job_title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      visitors: {
        Row: {
          created_at: string
          document_number: string
          document_type: string
          email: string | null
          first_name: string
          id: string
          last_name: string
          notes: string | null
          organisation: string | null
          phone: string | null
          reference: string
          risk: Database["public"]["Enums"]["risk_rating"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_number: string
          document_type?: string
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          notes?: string | null
          organisation?: string | null
          phone?: string | null
          reference?: string
          risk?: Database["public"]["Enums"]["risk_rating"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_number?: string
          document_type?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          organisation?: string | null
          phone?: string | null
          reference?: string
          risk?: Database["public"]["Enums"]["risk_rating"]
          updated_at?: string
        }
        Relationships: []
      }
      visits: {
        Row: {
          access_zone: string
          approval: string
          badge_returned: boolean
          booking_id: string | null
          checked_in_at: string
          checked_out_at: string | null
          created_at: string
          department_id: string | null
          expected_minutes: number
          host_id: string | null
          id: string
          notes: string | null
          pass_code: string
          purpose: string
          status: Database["public"]["Enums"]["visit_status"]
          updated_at: string
          visit_type: Database["public"]["Enums"]["visit_type"]
          visitor_id: string
        }
        Insert: {
          access_zone?: string
          approval?: string
          badge_returned?: boolean
          booking_id?: string | null
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          department_id?: string | null
          expected_minutes?: number
          host_id?: string | null
          id?: string
          notes?: string | null
          pass_code?: string
          purpose?: string
          status?: Database["public"]["Enums"]["visit_status"]
          updated_at?: string
          visit_type?: Database["public"]["Enums"]["visit_type"]
          visitor_id: string
        }
        Update: {
          access_zone?: string
          approval?: string
          badge_returned?: boolean
          booking_id?: string | null
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          department_id?: string | null
          expected_minutes?: number
          host_id?: string | null
          id?: string
          notes?: string | null
          pass_code?: string
          purpose?: string
          status?: Database["public"]["Enums"]["visit_status"]
          updated_at?: string
          visit_type?: Database["public"]["Enums"]["visit_type"]
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_delete_dept: {
        Args: { _dept: string; _user_id: string }
        Returns: boolean
      }
      can_delete_user: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      can_manage_dept: {
        Args: { _dept: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_global_admin: { Args: { _user_id: string }; Returns: boolean }
      role_rank: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: number
      }
      user_department: { Args: { _user_id: string }; Returns: string }
      user_rank: { Args: { _user_id: string }; Returns: number }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "dept_admin"
        | "dept_manager"
        | "dept_receptionist"
        | "receptionist"
      booking_status: "expected" | "arrived" | "cancelled"
      risk_rating: "clear" | "review" | "blocked"
      visit_status: "inside" | "checked_out"
      visit_type: "walk_in" | "pre_booked"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "admin",
        "dept_admin",
        "dept_manager",
        "dept_receptionist",
        "receptionist",
      ],
      booking_status: ["expected", "arrived", "cancelled"],
      risk_rating: ["clear", "review", "blocked"],
      visit_status: ["inside", "checked_out"],
      visit_type: ["walk_in", "pre_booked"],
    },
  },
} as const
