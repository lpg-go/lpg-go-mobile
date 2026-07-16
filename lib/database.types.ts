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
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      brands: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_preferred: boolean
          logo_url: string | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_preferred?: boolean
          logo_url?: string | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_preferred?: boolean
          logo_url?: string | null
          name?: string
        }
        Relationships: []
      }
      delivery_safety_checks: {
        Row: {
          checked_at: string
          created_at: string
          id: string
          notes: string | null
          order_id: string
          passed: boolean
          photos: Json
          rider_id: string
        }
        Insert: {
          checked_at?: string
          created_at?: string
          id?: string
          notes?: string | null
          order_id: string
          passed?: boolean
          photos?: Json
          rider_id: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          id?: string
          notes?: string | null
          order_id?: string
          passed?: boolean
          photos?: Json
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_safety_checks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_safety_checks_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_tiers: {
        Row: {
          credit: number
          name: string
          sort_order: number
          threshold: number
        }
        Insert: {
          credit: number
          name: string
          sort_order: number
          threshold: number
        }
        Update: {
          credit?: number
          name?: string
          sort_order?: number
          threshold?: number
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          order_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          order_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          order_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          is_read: boolean
          order_id: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_read?: boolean
          order_id?: string | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_read?: boolean
          order_id?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_acceptances: {
        Row: {
          accepted_at: string
          id: string
          order_id: string
          provider_id: string
          quoted_prices: Json | null
          quoted_total: number | null
          withdrawn_at: string | null
        }
        Insert: {
          accepted_at?: string
          id?: string
          order_id: string
          provider_id: string
          quoted_prices?: Json | null
          quoted_total?: number | null
          withdrawn_at?: string | null
        }
        Update: {
          accepted_at?: string
          id?: string
          order_id?: string
          provider_id?: string
          quoted_prices?: Json | null
          quoted_total?: number | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_acceptances_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_acceptances_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          provider_product_id: string
          quantity: number
          subtotal: number
          unit_price: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          provider_product_id: string
          quantity: number
          subtotal: number
          unit_price: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          provider_product_id?: string
          quantity?: number
          subtotal?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_provider_product_id_fkey"
            columns: ["provider_product_id"]
            isOneToOne: false
            referencedRelation: "provider_products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          admin_fee: number
          cancel_reason: string | null
          cancelled_by: Database["public"]["Enums"]["cancel_actor"] | null
          created_at: string
          customer_id: string
          delivered_at: string | null
          delivery_address: string
          delivery_completed_at: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_started_at: string | null
          eta_deadline: string | null
          eta_minutes: number | null
          expires_at: string | null
          express_fee: number
          id: string
          is_express: boolean
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          review_skipped: boolean
          selected_provider_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          admin_fee?: number
          cancel_reason?: string | null
          cancelled_by?: Database["public"]["Enums"]["cancel_actor"] | null
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          delivery_address: string
          delivery_completed_at?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_started_at?: string | null
          eta_deadline?: string | null
          eta_minutes?: number | null
          expires_at?: string | null
          express_fee?: number
          id?: string
          is_express?: boolean
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          review_skipped?: boolean
          selected_provider_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total_amount: number
          updated_at?: string
        }
        Update: {
          admin_fee?: number
          cancel_reason?: string | null
          cancelled_by?: Database["public"]["Enums"]["cancel_actor"] | null
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          delivery_address?: string
          delivery_completed_at?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_started_at?: string | null
          eta_deadline?: string | null
          eta_minutes?: number | null
          expires_at?: string | null
          express_fee?: number
          id?: string
          is_express?: boolean
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          review_skipped?: boolean
          selected_provider_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_selected_provider_id_fkey"
            columns: ["selected_provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_verifications: {
        Row: {
          attempts: number
          code: string
          created_at: string
          expires_at: string
          id: string
          phone: string
          used: boolean
        }
        Insert: {
          attempts?: number
          code: string
          created_at?: string
          expires_at: string
          id?: string
          phone: string
          used?: boolean
        }
        Update: {
          attempts?: number
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          used?: boolean
        }
        Relationships: []
      }
      password_reset_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          phone: string
          used: boolean
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          phone: string
          used?: boolean
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          used?: boolean
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          allow_card_payment: boolean
          allow_cash_payment: boolean
          app_logo_url: string | null
          compliance_text: string | null
          compliance_version: number
          eta_average_speed_kmh: number
          eta_mercy_minutes: number
          express_delivery_fee: number
          express_enabled: boolean
          express_platform_cut_percent: number
          id: number
          loyalty_enabled: boolean
          max_active_orders_per_customer: number
          min_balance: number
          min_stock_level: number
          order_expiry_accepted_minutes: number
          order_expiry_minutes: number
          otp_enabled: boolean
          require_provider_document: boolean
          signup_promo_amount: number
          signup_promo_count: number
          signup_promo_enabled: boolean
          signup_promo_granted: number
          updated_at: string
        }
        Insert: {
          allow_card_payment?: boolean
          allow_cash_payment?: boolean
          app_logo_url?: string | null
          compliance_text?: string | null
          compliance_version?: number
          eta_average_speed_kmh?: number
          eta_mercy_minutes?: number
          express_delivery_fee?: number
          express_enabled?: boolean
          express_platform_cut_percent?: number
          id?: number
          loyalty_enabled?: boolean
          max_active_orders_per_customer?: number
          min_balance?: number
          min_stock_level?: number
          order_expiry_accepted_minutes?: number
          order_expiry_minutes?: number
          otp_enabled?: boolean
          require_provider_document?: boolean
          signup_promo_amount?: number
          signup_promo_count?: number
          signup_promo_enabled?: boolean
          signup_promo_granted?: number
          updated_at?: string
        }
        Update: {
          allow_card_payment?: boolean
          allow_cash_payment?: boolean
          app_logo_url?: string | null
          compliance_text?: string | null
          compliance_version?: number
          eta_average_speed_kmh?: number
          eta_mercy_minutes?: number
          express_delivery_fee?: number
          express_enabled?: boolean
          express_platform_cut_percent?: number
          id?: number
          loyalty_enabled?: boolean
          max_active_orders_per_customer?: number
          min_balance?: number
          min_stock_level?: number
          order_expiry_accepted_minutes?: number
          order_expiry_minutes?: number
          otp_enabled?: boolean
          require_provider_document?: boolean
          signup_promo_amount?: number
          signup_promo_count?: number
          signup_promo_enabled?: boolean
          signup_promo_granted?: number
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          admin_fee: number
          brand_id: string
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          size_kg: number
        }
        Insert: {
          admin_fee?: number
          brand_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          size_kg: number
        }
        Update: {
          admin_fee?: number
          brand_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          size_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          avg_delivery_minutes: number | null
          balance: number
          business_name: string | null
          created_at: string
          display_id: string | null
          document_type: string | null
          document_url: string | null
          expo_push_token: string | null
          full_name: string
          id: string
          is_approved: boolean
          is_online: boolean
          last_loyalty_month: string | null
          loyalty_tier: string | null
          phone: string
          provider_type: Database["public"]["Enums"]["provider_type"] | null
          rejected_at: string | null
          rejection_reason: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          avg_delivery_minutes?: number | null
          balance?: number
          business_name?: string | null
          created_at?: string
          display_id?: string | null
          document_type?: string | null
          document_url?: string | null
          expo_push_token?: string | null
          full_name: string
          id: string
          is_approved?: boolean
          is_online?: boolean
          last_loyalty_month?: string | null
          loyalty_tier?: string | null
          phone: string
          provider_type?: Database["public"]["Enums"]["provider_type"] | null
          rejected_at?: string | null
          rejection_reason?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          avg_delivery_minutes?: number | null
          balance?: number
          business_name?: string | null
          created_at?: string
          display_id?: string | null
          document_type?: string | null
          document_url?: string | null
          expo_push_token?: string | null
          full_name?: string
          id?: string
          is_approved?: boolean
          is_online?: boolean
          last_loyalty_month?: string | null
          loyalty_tier?: string | null
          phone?: string
          provider_type?: Database["public"]["Enums"]["provider_type"] | null
          rejected_at?: string | null
          rejection_reason?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      provider_compliance_acceptances: {
        Row: {
          accepted_at: string
          id: string
          provider_id: string
          undertaking_text: string
          version: number
        }
        Insert: {
          accepted_at?: string
          id?: string
          provider_id: string
          undertaking_text: string
          version: number
        }
        Update: {
          accepted_at?: string
          id?: string
          provider_id?: string
          undertaking_text?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_compliance_acceptances_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_locations: {
        Row: {
          id: string
          lat: number
          lng: number
          provider_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          lat: number
          lng: number
          provider_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          lat?: number
          lng?: number
          provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_locations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_products: {
        Row: {
          id: string
          is_available: boolean
          price: number
          product_id: string
          provider_id: string
        }
        Insert: {
          id?: string
          is_available?: boolean
          price: number
          product_id: string
          provider_id: string
        }
        Update: {
          id?: string
          is_available?: boolean
          price?: number
          product_id?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_products_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          customer_id: string
          delivery_speed: string | null
          id: string
          order_id: string
          provider_id: string
          rating: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          customer_id: string
          delivery_speed?: string | null
          id?: string
          order_id: string
          provider_id: string
          rating: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          customer_id?: string
          delivery_speed?: string | null
          id?: string
          order_id?: string
          provider_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          order_id: string | null
          provider_id: string
          reference_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          order_id?: string | null
          provider_id: string
          reference_id?: string | null
          type: Database["public"]["Enums"]["transaction_type"]
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          order_id?: string | null
          provider_id?: string
          reference_id?: string | null
          type?: Database["public"]["Enums"]["transaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_order: { Args: { p_order_id: string }; Returns: undefined }
      assign_all_products_to_provider: {
        Args: { provider_uuid: string }
        Returns: undefined
      }
      calculate_provider_avg_delivery_time: {
        Args: { provider_uuid: string }
        Returns: number
      }
      cancel_order: { Args: { p_order_id: string }; Returns: undefined }
      confirm_delivery: { Args: { p_order_id: string }; Returns: undefined }
      consume_otp: {
        Args: { p_code: string; p_phone: string }
        Returns: string
      }
      expire_pending_orders: { Args: never; Returns: undefined }
      generate_display_id: {
        Args: {
          p_provider_type: Database["public"]["Enums"]["provider_type"]
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      is_provider: { Args: never; Returns: boolean }
      mark_delivered: { Args: { p_order_id: string }; Returns: undefined }
      place_order: {
        Args: {
          p_delivery_address: string
          p_delivery_lat: number
          p_delivery_lng: number
          p_is_express?: boolean
          p_payment_method?: string
          p_product_id: string
          p_quantity: number
        }
        Returns: string
      }
      provider_withdraw: { Args: { p_order_id: string }; Returns: undefined }
      run_monthly_loyalty: { Args: never; Returns: undefined }
      select_provider_for_order: {
        Args: {
          p_is_express?: boolean
          p_order_id: string
          p_payment_method?: string
          p_provider_id: string
        }
        Returns: undefined
      }
      set_order_eta: { Args: { p_order_id: string }; Returns: undefined }
    }
    Enums: {
      cancel_actor: "customer" | "provider" | "system"
      order_status:
        | "pending"
        | "awaiting_dealer_selection"
        | "in_transit"
        | "awaiting_confirmation"
        | "delivered"
        | "cancelled"
      payment_method: "cash" | "card"
      provider_type: "dealer" | "rider"
      transaction_type:
        | "topup"
        | "fee_deduction"
        | "promo"
        | "loyalty"
        | "express_platform_fee"
      user_role: "customer" | "provider" | "admin"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      cancel_actor: ["customer", "provider", "system"],
      order_status: [
        "pending",
        "awaiting_dealer_selection",
        "in_transit",
        "awaiting_confirmation",
        "delivered",
        "cancelled",
      ],
      payment_method: ["cash", "card"],
      provider_type: ["dealer", "rider"],
      transaction_type: [
        "topup",
        "fee_deduction",
        "promo",
        "loyalty",
        "express_platform_fee",
      ],
      user_role: ["customer", "provider", "admin"],
    },
  },
} as const
