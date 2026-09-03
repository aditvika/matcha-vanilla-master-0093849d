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
      profiles: {
        Row: {
          created_at: string
          daily_photo_count: number
          daily_video_count: number
          display_name: string | null
          email: string | null
          id: string
          is_premium: boolean
          last_active_server_date: string | null
          monthly_video_count_premium: number
          mvc_balance: number
          package_type: string | null
          premium_started_at: string | null
          premium_until: string | null
          total_mvp_points: number
          updated_at: string
          weekly_video_count_premium: number
        }
        Insert: {
          created_at?: string
          daily_photo_count?: number
          daily_video_count?: number
          display_name?: string | null
          email?: string | null
          id: string
          is_premium?: boolean
          last_active_server_date?: string | null
          monthly_video_count_premium?: number
          mvc_balance?: number
          package_type?: string | null
          premium_started_at?: string | null
          premium_until?: string | null
          total_mvp_points?: number
          updated_at?: string
          weekly_video_count_premium?: number
        }
        Update: {
          created_at?: string
          daily_photo_count?: number
          daily_video_count?: number
          display_name?: string | null
          email?: string | null
          id?: string
          is_premium?: boolean
          last_active_server_date?: string | null
          monthly_video_count_premium?: number
          mvc_balance?: number
          package_type?: string | null
          premium_started_at?: string | null
          premium_until?: string | null
          total_mvp_points?: number
          updated_at?: string
          weekly_video_count_premium?: number
        }
        Relationships: []
      }
      quota_usage: {
        Row: {
          bucket: string
          created_at: string
          id: string
          period_end: string
          period_start: string
          updated_at: string
          used_count: number
          user_id: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          updated_at?: string
          used_count?: number
          user_id: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          updated_at?: string
          used_count?: number
          user_id?: string
        }
        Relationships: []
      }
      vouchers: {
        Row: {
          code: string
          created_at: string
          id: string
          is_used: boolean
          package_type: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_used?: boolean
          package_type: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_used?: boolean
          package_type?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_inject_mvc: {
        Args: { p_amount: number; p_email: string }
        Returns: Json
      }
      claim_voucher: { Args: { p_code: string }; Returns: Json }
      consume_credits: {
        Args: { p_kind: string; p_resolution: string }
        Returns: Json
      }
      consume_daily_credit: { Args: { p_kind: string }; Returns: Json }
      consume_mvc: { Args: { p_amount: number; p_kind: string }; Returns: Json }
      consume_quota: {
        Args: { p_kind: string; p_resolution: string }
        Returns: Json
      }
      credit_rule: {
        Args: { _kind: string; _resolution: string; _tier: string }
        Returns: {
          bucket: string
          cost: number
          pool_max: number
        }[]
      }
      get_credit_status: { Args: never; Returns: Json }
      get_leaderboard: {
        Args: never
        Returns: {
          display_name: string
          mvp_points: number
          package_type: string
        }[]
      }
      get_quota_status: { Args: never; Returns: Json }
      get_server_date: { Args: never; Returns: string }
      quota_limit: {
        Args: { _kind: string; _resolution: string; _tier: string }
        Returns: {
          bucket: string
          max_uses: number
        }[]
      }
      quota_window: {
        Args: { _user_id: string }
        Returns: {
          period_end: string
          period_start: string
          tier: string
        }[]
      }
      refund_credits: {
        Args: { p_kind: string; p_resolution: string }
        Returns: Json
      }
      reset_daily_counts_if_new_day: { Args: never; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
