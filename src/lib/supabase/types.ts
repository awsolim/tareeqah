export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      mosques: {
        Row: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          primary_color: string | null;
          secondary_color: string | null;
          stripe_account_id: string | null;
          welcome_title: string | null;
          welcome_description: string | null;
          features: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["mosques"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["mosques"]["Row"]>;
        Relationships: [];
      };
      programs: {
        Row: {
          id: string;
          mosque_id: string;
          teacher_profile_id: string | null;
          title: string;
          description: string | null;
          is_active: boolean;
          is_paid: boolean;
          thumbnail_url: string | null;
          price_monthly_cents: number | null;
          stripe_product_id: string | null;
          stripe_price_id: string | null;
          audience_gender: string | null;
          age_range_text: string | null;
          schedule: Json | null;
          schedule_timezone: string | null;
          schedule_notes: string | null;
          tags: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["programs"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["programs"]["Row"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string | null;
          phone_number: string | null;
          avatar_url: string | null;
          teacher_credentials: string | null;
          age: string | null;
          gender: string | null;
          account_type: string | null;
          global_role: string | null;
          date_of_birth: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      mosque_memberships: {
        Row: {
          id: string;
          mosque_id: string;
          profile_id: string;
          role: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["mosque_memberships"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["mosque_memberships"]["Row"]>;
        Relationships: [];
      };
      program_teachers: {
        Row: {
          id: string;
          program_id: string;
          teacher_profile_id: string;
          role: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_teachers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_teachers"]["Row"]>;
        Relationships: [];
      };
      enrollment_requests: {
        Row: {
          id: string;
          mosque_id: string;
          program_id: string;
          student_profile_id: string;
          parent_profile_id: string | null;
          status: string;
          requested_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          student_dismissed_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["enrollment_requests"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["enrollment_requests"]["Row"]>;
        Relationships: [];
      };
      program_announcements: {
        Row: {
          id: string;
          program_id: string;
          author_profile_id: string;
          message: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_announcements"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_announcements"]["Row"]>;
        Relationships: [];
      };
      program_announcement_receipts: {
        Row: {
          id: string;
          announcement_id: string;
          profile_id: string;
          read_at: string | null;
          dismissed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_announcement_receipts"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_announcement_receipts"]["Row"]>;
        Relationships: [];
      };
      program_session_cancellations: {
        Row: {
          id: string;
          program_id: string;
          session_date: string;
          start_time: string;
          end_time: string | null;
          cancelled_by: string | null;
          announcement_id: string | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_session_cancellations"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_session_cancellations"]["Row"]>;
        Relationships: [];
      };
      program_subscriptions: {
        Row: {
          id: string;
          mosque_id: string | null;
          program_id: string | null;
          student_profile_id: string | null;
          parent_profile_id: string | null;
          enrollment_request_id: string | null;
          stripe_account_id: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_price_id: string | null;
          status: string;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_subscriptions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_subscriptions"]["Row"]>;
        Relationships: [];
      };
      program_details: {
        Row: {
          program_id: string;
          learning_intro: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_details"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_details"]["Row"]>;
        Relationships: [];
      };
      program_outcomes: {
        Row: {
          id: string;
          program_id: string;
          sort_order: number;
          text: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_outcomes"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_outcomes"]["Row"]>;
        Relationships: [];
      };
      program_content_sections: {
        Row: {
          id: string;
          program_id: string;
          sort_order: number;
          title: string;
          description: string | null;
          duration_text: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_content_sections"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_content_sections"]["Row"]>;
        Relationships: [];
      };
      program_media: {
        Row: {
          id: string;
          program_id: string;
          sort_order: number;
          media_type: string;
          url: string;
          thumbnail_url: string | null;
          title: string | null;
          short_label: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_media"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_media"]["Row"]>;
        Relationships: [];
      };
      parent_child_links: {
        Row: {
          id: string;
          parent_profile_id: string;
          child_profile_id: string;
          mosque_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["parent_child_links"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["parent_child_links"]["Row"]>;
        Relationships: [];
      };
      enrollments: {
        Row: {
          id: string;
          program_id: string;
          student_profile_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["enrollments"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["enrollments"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_parent_child_profile: {
        Args: {
          child_full_name: string;
          child_gender: string;
          child_date_of_birth: string;
          child_mosque_slug: string;
        };
        Returns: string;
      };
      complete_oauth_profile: {
        Args: {
          signup_account_type: string;
          signup_full_name: string;
          signup_phone: string;
          signup_gender: string;
          signup_date_of_birth: string | null;
          signup_mosque_slug: string;
        };
        Returns: void;
      };
      has_mosque_role: {
        Args: { check_mosque_id: string; allowed_roles: string[]; check_profile_id?: string };
        Returns: boolean;
      };
      is_program_teacher: {
        Args: { check_program_id: string; check_profile_id?: string };
        Returns: boolean;
      };
      can_manage_program: {
        Args: { check_program_id: string; check_profile_id?: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
