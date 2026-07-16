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
          picture_url: string | null;
          address: string | null;
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
          director_profile_id: string | null;
          internal_name: string | null;
          title: string;
          summary: string | null;
          description: string | null;
          category: string | null;
          program_type: string;
          publication_status: string;
          application_status: string;
          lifecycle_status: string;
          application_mode: string;
          accepting_applications: boolean;
          application_open_at: string | null;
          application_close_at: string | null;
          waitlist_enabled: boolean;
          capacity_behavior: string;
          default_capacity: number | null;
          duration_type: string;
          start_now: boolean;
          start_date: string | null;
          end_date: string | null;
          duration_months: number | null;
          is_ongoing: boolean;
          schedule_pattern: string;
          registration_deadline_at: string | null;
          location: string | null;
          room: string | null;
          is_active: boolean;
          is_paid: boolean;
          payment_kind: string;
          billing_start_behavior: string;
          offers_monthly_payment: boolean;
          offers_annual_payment: boolean;
          billing_end_behavior: string;
          billing_duration_months: number;
          allow_custom_prices: boolean;
          allow_waived_payments: boolean;
          manual_payment_note: string | null;
          financial_assistance_note: string | null;
          receipt_note: string | null;
          contact_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          thumbnail_url: string | null;
          price_monthly_cents: number | null;
          price_annual_cents: number | null;
          stripe_product_id: string | null;
          stripe_price_id: string | null;
          stripe_annual_price_id: string | null;
          audience_gender: string | null;
          age_range_text: string | null;
          schedule: Json | null;
          schedule_timezone: string | null;
          schedule_notes: string | null;
          track_selection_mode: string;
          track_selection_count: number;
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
          teacher_whatsapp_number: string | null;
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
          teacher_approval_status: string | null;
          teacher_approval_reviewed_by: string | null;
          teacher_approval_reviewed_at: string | null;
          can_create_programs: boolean;
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
          teacher_profile_id: string | null;
          role: string;
          can_manage_finances: boolean;
          invite_code: string | null;
          invite_code_created_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_teachers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_teachers"]["Row"]>;
        Relationships: [];
      };
      program_instructor_events: {
        Row: {
          id: string;
          program_id: string;
          assignment_id: string | null;
          teacher_profile_id: string | null;
          event_type: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_instructor_events"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_instructor_events"]["Row"]>;
        Relationships: [];
      };
      enrollment_requests: {
        Row: {
          id: string;
          mosque_id: string;
          program_id: string;
          student_profile_id: string;
          parent_profile_id: string | null;
          program_track_id: string | null;
          status: string;
          requested_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          payment_type: string;
          approved_price_monthly_cents: number | null;
          approved_price_annual_cents: number | null;
          payment_bypassed: boolean;
          decision_note: string | null;
          admission_completed_at: string | null;
          student_dismissed_at: string | null;
          teacher_dismissed_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["enrollment_requests"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["enrollment_requests"]["Row"]>;
        Relationships: [];
      };
      withdrawal_requests: {
        Row: {
          id: string;
          mosque_id: string;
          program_id: string;
          enrollment_id: string | null;
          student_profile_id: string;
          parent_profile_id: string | null;
          requested_by: string;
          status: string;
          requested_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          reason: string | null;
          understands_no_refund: boolean;
          understands_immediate_exit: boolean;
          decision_note: string | null;
          teacher_dismissed_at: string | null;
          student_dismissed_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["withdrawal_requests"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["withdrawal_requests"]["Row"]>;
        Relationships: [];
      };
      program_announcements: {
        Row: {
          id: string;
          program_id: string;
          author_profile_id: string;
          message: string;
          target_program_track_ids: string[];
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
      enrollment_request_tracks: {
        Row: {
          enrollment_request_id: string;
          program_track_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["enrollment_request_tracks"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["enrollment_request_tracks"]["Row"]>;
        Relationships: [];
      };
      program_student_notes: {
        Row: {
          id: string;
          mosque_id: string;
          program_id: string;
          student_profile_id: string;
          recipient_profile_id: string;
          parent_profile_id: string | null;
          author_profile_id: string;
          message: string;
          category: string;
          seen_at: string | null;
          seen_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_student_notes"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_student_notes"]["Row"]>;
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
          program_track_id: string | null;
          enrollment_request_id: string | null;
          stripe_account_id: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_price_id: string | null;
          payment_type: string;
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
      program_finance_audit_events: {
        Row: {
          id: string;
          program_id: string;
          student_profile_id: string | null;
          actor_profile_id: string | null;
          event_type: string;
          summary: string;
          metadata: Json;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_finance_audit_events"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_finance_audit_events"]["Row"]>;
        Relationships: [];
      };
      program_details: {
        Row: {
          program_id: string;
          learning_intro: string | null;
          learning_title: string;
          requirements_text: string | null;
          what_to_bring_text: string | null;
          policies_text: string | null;
          topics_intro: string | null;
          instructor_display_name: string | null;
          instructor_credentials: string | null;
          instructor_contact_phone: string | null;
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
      program_faqs: {
        Row: {
          id: string;
          program_id: string;
          sort_order: number;
          question: string;
          answer: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_faqs"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_faqs"]["Row"]>;
        Relationships: [];
      };
      program_subscription_tracks: {
        Row: {
          program_subscription_id: string;
          program_track_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_subscription_tracks"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_subscription_tracks"]["Row"]>;
        Relationships: [];
      };
      program_tracks: {
        Row: {
          id: string;
          program_id: string;
          name: string;
          description: string | null;
          schedule: Json | null;
          gender_override: string | null;
          age_min: number | null;
          age_max: number | null;
          location: string | null;
          room: string | null;
          capacity: number | null;
          pricing_override_enabled: boolean;
          price_monthly_cents: number | null;
          price_annual_cents: number | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_tracks"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_tracks"]["Row"]>;
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
          caption: string | null;
          alt_text: string | null;
          short_label: string | null;
          is_featured: boolean;
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
          program_track_id: string | null;
          status: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["enrollments"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["enrollments"]["Row"]>;
        Relationships: [];
      };
      program_sessions: {
        Row: {
          id: string;
          program_id: string;
          program_track_id: string | null;
          session_date: string;
          start_time: string;
          end_time: string | null;
          title: string | null;
          location: string | null;
          room: string | null;
          notes: string | null;
          capacity: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_sessions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_sessions"]["Row"]>;
        Relationships: [];
      };
      enrollment_tracks: {
        Row: {
          enrollment_id: string;
          program_track_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["enrollment_tracks"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["enrollment_tracks"]["Row"]>;
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
      update_parent_child_profile: {
        Args: {
          child_profile_id: string;
          child_full_name: string;
          child_gender: string;
          child_date_of_birth: string;
          child_mosque_slug: string;
        };
        Returns: void;
      };
      update_enrollment_track_selection: {
        Args: {
          target_enrollment_id: string;
          selected_track_ids: string[];
        };
        Returns: void;
      };
      request_program_withdrawal: {
        Args: {
          target_program_id: string;
          target_student_profile_id: string;
          withdrawal_reason?: string | null;
          understands_no_refund?: boolean;
          understands_immediate_exit?: boolean;
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
      is_platform_admin: {
        Args: { check_profile_id?: string };
        Returns: boolean;
      };
      is_program_director: {
        Args: { check_program_id: string; check_profile_id?: string };
        Returns: boolean;
      };
      approve_teacher_membership: {
        Args: { target_membership_id: string; target_status: string };
        Returns: void;
      };
      claim_program_instructor_code: {
        Args: { invite: string };
        Returns: string;
      };
      lookup_program_instructor_code: {
        Args: { invite: string };
        Returns: Array<{ program_id: string; title: string; director_name: string }>;
      };
      resign_program_instructor: {
        Args: { target_program_id: string };
        Returns: void;
      };
      mark_program_student_notes_seen: {
        Args: { note_ids: string[] };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
