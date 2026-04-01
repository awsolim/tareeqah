export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string | null;
          phone_number: string | null;
          avatar_url: string | null;
          age: string | null;
          gender: string | null;
          global_role: "platform_admin" | null;
          date_of_birth: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          email?: string | null;
          phone_number?: string | null;
          avatar_url?: string | null;
          age?: string | null;
          gender?: string | null;
          global_role?: "platform_admin" | null;
          date_of_birth?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          email?: string | null;
          phone_number?: string | null;
          avatar_url?: string | null;
          age?: string | null;
          gender?: string | null;
          global_role?: "platform_admin" | null;
          date_of_birth?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

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
          features: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          logo_url?: string | null;
          primary_color?: string | null;
          secondary_color?: string | null;
          stripe_account_id?: string | null;
          welcome_title?: string | null;
          welcome_description?: string | null;
          features?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          logo_url?: string | null;
          primary_color?: string | null;
          secondary_color?: string | null;
          stripe_account_id?: string | null;
          welcome_title?: string | null;
          welcome_description?: string | null;
          features?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      mosque_memberships: {
        Row: {
          id: string;
          mosque_id: string;
          profile_id: string;
          role: "mosque_admin" | "lead_teacher" | "teacher" | "student" | "parent";
          can_manage_programs: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          mosque_id: string;
          profile_id: string;
          role: "mosque_admin" | "lead_teacher" | "teacher" | "student" | "parent";
          can_manage_programs?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          mosque_id?: string;
          profile_id?: string;
          role?: "mosque_admin" | "lead_teacher" | "teacher" | "student" | "parent";
          can_manage_programs?: boolean;
          created_at?: string;
        };
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
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          mosque_id: string;
          teacher_profile_id?: string | null;
          title: string;
          description?: string | null;
          is_active?: boolean;
          is_paid?: boolean;
          thumbnail_url?: string | null;
          price_monthly_cents?: number | null;
          stripe_product_id?: string | null;
          stripe_price_id?: string | null;
          audience_gender?: string | null;
          age_range_text?: string | null;
          schedule?: Json | null;
          schedule_timezone?: string | null;
          schedule_notes?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          mosque_id?: string;
          teacher_profile_id?: string | null;
          title?: string;
          description?: string | null;
          is_active?: boolean;
          is_paid?: boolean;
          thumbnail_url?: string | null;
          price_monthly_cents?: number | null;
          stripe_product_id?: string | null;
          stripe_price_id?: string | null;
          audience_gender?: string | null;
          age_range_text?: string | null;
          schedule?: Json | null;
          schedule_timezone?: string | null;
          schedule_notes?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      enrollments: {
        Row: {
          id: string;
          program_id: string;
          student_profile_id: string;
          payment_waived: boolean;
          waived_by: string | null;
          waived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          program_id: string;
          student_profile_id: string;
          payment_waived?: boolean;
          waived_by?: string | null;
          waived_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string;
          student_profile_id?: string;
          payment_waived?: boolean;
          waived_by?: string | null;
          waived_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };

      program_applications: {
        Row: {
          id: string;
          program_id: string;
          student_profile_id: string;
          status: "pending" | "accepted" | "rejected" | "joined";
          created_at: string;
          reviewed_at: string | null;
          joined_at: string | null;
        };
        Insert: {
          id?: string;
          program_id: string;
          student_profile_id: string;
          status?: "pending" | "accepted" | "rejected" | "joined";
          created_at?: string;
          reviewed_at?: string | null;
          joined_at?: string | null;
        };
        Update: {
          id?: string;
          program_id?: string;
          student_profile_id?: string;
          status?: "pending" | "accepted" | "rejected" | "joined";
          created_at?: string;
          reviewed_at?: string | null;
          joined_at?: string | null;
        };
        Relationships: [];
      };

      program_subscriptions: {
        Row: {
          id: string;
          program_id: string;
          student_profile_id: string;
          stripe_subscription_id: string | null;
          stripe_customer_id: string | null;
          status: "active" | "canceled" | "ended";
          created_at: string;
          updated_at: string;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          program_id: string;
          student_profile_id: string;
          stripe_subscription_id?: string | null;
          stripe_customer_id?: string | null;
          status?: "active" | "canceled" | "ended";
          created_at?: string;
          updated_at?: string;
          ended_at?: string | null;
        };
        Update: {
          id?: string;
          program_id?: string;
          student_profile_id?: string;
          stripe_subscription_id?: string | null;
          stripe_customer_id?: string | null;
          status?: "active" | "canceled" | "ended";
          created_at?: string;
          updated_at?: string;
          ended_at?: string | null;
        };
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
        Insert: {
          id?: string;
          program_id: string;
          author_profile_id: string;
          message: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string;
          author_profile_id?: string;
          message?: string;
          created_at?: string;
          updated_at?: string;
        };
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
        Insert: {
          id?: string;
          parent_profile_id: string;
          child_profile_id: string;
          mosque_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          parent_profile_id?: string;
          child_profile_id?: string;
          mosque_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };

      teacher_join_requests: {
        Row: {
          id: string;
          mosque_id: string;
          profile_id: string;
          status: "pending" | "approved" | "rejected";
          reviewed_by: string | null;
          created_at: string;
          reviewed_at: string | null;
        };
        Insert: {
          id?: string;
          mosque_id: string;
          profile_id: string;
          status?: "pending" | "approved" | "rejected";
          reviewed_by?: string | null;
          created_at?: string;
          reviewed_at?: string | null;
        };
        Update: {
          id?: string;
          mosque_id?: string;
          profile_id?: string;
          status?: "pending" | "approved" | "rejected";
          reviewed_by?: string | null;
          created_at?: string;
          reviewed_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
