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
  public: {
    Tables: {
      activities: {
        Row: {
          created_at: string | null
          created_by: string | null
          due_date: string | null
          grades_published_at: string | null
          grades_published_by: string | null
          id: string
          max_score: number
          subject_id: string | null
          title: string
          type: string
          weight: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          grades_published_at?: string | null
          grades_published_by?: string | null
          id?: string
          max_score?: number
          subject_id?: string | null
          title: string
          type: string
          weight?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          grades_published_at?: string | null
          grades_published_by?: string | null
          id?: string
          max_score?: number
          subject_id?: string | null
          title?: string
          type?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_views: {
        Row: {
          announcement_id: string
          id: string
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          announcement_id: string
          id?: string
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          announcement_id?: string
          id?: string
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcement_views_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          content: string
          created_at: string | null
          expires_at: string | null
          id: string
          instructor_id: string
          is_pinned: boolean | null
          is_published: boolean | null
          priority: string | null
          published_at: string | null
          subject_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          instructor_id: string
          is_pinned?: boolean | null
          is_published?: boolean | null
          priority?: string | null
          published_at?: string | null
          subject_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          instructor_id?: string
          is_pinned?: boolean | null
          is_published?: boolean | null
          priority?: string | null
          published_at?: string | null
          subject_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          created_at: string | null
          date: string
          id: string
          recorded_by: string | null
          status: string
          student_id: string | null
          subject_id: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          recorded_by?: string | null
          status: string
          student_id?: string | null
          subject_id?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          recorded_by?: string | null
          status?: string
          student_id?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      counseling_referrals: {
        Row: {
          counselor_remarks: string | null
          created_at: string
          id: string
          instructor_id: string
          prediction_id: string | null
          recommendation_message: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          student_id: string
          subject_id: string
        }
        Insert: {
          counselor_remarks?: string | null
          created_at?: string
          id?: string
          instructor_id: string
          prediction_id?: string | null
          recommendation_message?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id: string
          subject_id: string
        }
        Update: {
          counselor_remarks?: string | null
          created_at?: string
          id?: string
          instructor_id?: string
          prediction_id?: string | null
          recommendation_message?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counseling_referrals_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counseling_referrals_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_replies: {
        Row: {
          author_id: string
          content: string
          created_at: string | null
          id: string
          is_deleted: boolean | null
          parent_reply_id: string | null
          thread_id: string
          updated_at: string | null
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          parent_reply_id?: string | null
          thread_id: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          parent_reply_id?: string | null
          thread_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discussion_replies_parent_reply_id_fkey"
            columns: ["parent_reply_id"]
            isOneToOne: false
            referencedRelation: "discussion_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_replies_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "discussion_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_threads: {
        Row: {
          author_id: string
          content: string
          created_at: string | null
          id: string
          is_locked: boolean | null
          is_pinned: boolean | null
          last_reply_at: string | null
          reply_count: number | null
          subject_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string | null
          id?: string
          is_locked?: boolean | null
          is_pinned?: boolean | null
          last_reply_at?: string | null
          reply_count?: number | null
          subject_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string | null
          id?: string
          is_locked?: boolean | null
          is_pinned?: boolean | null
          last_reply_at?: string | null
          reply_count?: number | null
          subject_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discussion_threads_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      email_notifications: {
        Row: {
          channel: string
          id: string
          risk_level: string
          sent_at: string
          student_id: string | null
          subject_id: string | null
        }
        Insert: {
          channel?: string
          id?: string
          risk_level: string
          sent_at?: string
          student_id?: string | null
          subject_id?: string | null
        }
        Update: {
          channel?: string
          id?: string
          risk_level?: string
          sent_at?: string
          student_id?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_notifications_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          created_at: string
          dedupe_key: string
          from_level: string | null
          from_score: number | null
          id: string
          message: string
          status: string
          student_id: string
          title: string
          to_level: string | null
          to_score: number | null
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          created_at?: string
          dedupe_key: string
          from_level?: string | null
          from_score?: number | null
          id?: string
          message: string
          status?: string
          student_id: string
          title: string
          to_level?: string | null
          to_score?: number | null
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string
          dedupe_key?: string
          from_level?: string | null
          from_score?: number | null
          id?: string
          message?: string
          status?: string
          student_id?: string
          title?: string
          to_level?: string | null
          to_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      engagement_interventions: {
        Row: {
          action_type: string
          alert_id: string | null
          created_at: string
          id: string
          instructor_id: string
          metadata: Json
          note: string | null
          student_id: string
        }
        Insert: {
          action_type: string
          alert_id?: string | null
          created_at?: string
          id?: string
          instructor_id: string
          metadata?: Json
          note?: string | null
          student_id: string
        }
        Update: {
          action_type?: string
          alert_id?: string | null
          created_at?: string
          id?: string
          instructor_id?: string
          metadata?: Json
          note?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_interventions_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "engagement_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          enrolled_at: string | null
          id: string
          status: string | null
          student_id: string | null
          subject_id: string | null
        }
        Insert: {
          enrolled_at?: string | null
          id?: string
          status?: string | null
          student_id?: string | null
          subject_id?: string | null
        }
        Update: {
          enrolled_at?: string | null
          id?: string
          status?: string | null
          student_id?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_reports: {
        Row: {
          created_by: string
          expires_at: string | null
          file_size: number | null
          file_url: string | null
          generated_at: string | null
          id: string
          parameters: Json | null
          status: string | null
          template_id: string
        }
        Insert: {
          created_by: string
          expires_at?: string | null
          file_size?: number | null
          file_url?: string | null
          generated_at?: string | null
          id?: string
          parameters?: Json | null
          status?: string | null
          template_id: string
        }
        Update: {
          created_by?: string
          expires_at?: string | null
          file_size?: number | null
          file_url?: string | null
          generated_at?: string | null
          id?: string
          parameters?: Json | null
          status?: string | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_reports_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      interventions: {
        Row: {
          id: string
          message: string | null
          prediction_id: string | null
          sent_at: string | null
          status: string | null
          student_id: string | null
          subject_id: string | null
          type: string
        }
        Insert: {
          id?: string
          message?: string | null
          prediction_id?: string | null
          sent_at?: string | null
          status?: string | null
          student_id?: string | null
          subject_id?: string | null
          type: string
        }
        Update: {
          id?: string
          message?: string | null
          prediction_id?: string | null
          sent_at?: string | null
          status?: string | null
          student_id?: string | null
          subject_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "interventions_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_recommendations: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          description: string
          expires_at: string | null
          id: string
          is_actioned: boolean | null
          priority: string | null
          recommendation_type: string
          student_id: string
          subject_id: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          description: string
          expires_at?: string | null
          id?: string
          is_actioned?: boolean | null
          priority?: string | null
          recommendation_type: string
          student_id: string
          subject_id?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          description?: string
          expires_at?: string | null
          id?: string
          is_actioned?: boolean | null
          priority?: string | null
          recommendation_type?: string
          student_id?: string
          subject_id?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_recommendations_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_resources: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          difficulty_level: number | null
          estimated_time_minutes: number | null
          id: string
          is_active: boolean | null
          resource_type: string
          subject_id: string | null
          tags: string[] | null
          title: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty_level?: number | null
          estimated_time_minutes?: number | null
          id?: string
          is_active?: boolean | null
          resource_type: string
          subject_id?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty_level?: number | null
          estimated_time_minutes?: number | null
          id?: string
          is_active?: boolean | null
          resource_type?: string
          subject_id?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_resources_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      message_read_receipts: {
        Row: {
          id: string
          message_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          id?: string
          message_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          id?: string
          message_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_read_receipts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_deleted: boolean | null
          is_read: boolean | null
          message_type: string | null
          receiver_id: string
          reply_to: string | null
          sender_id: string
          subject_id: string | null
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          is_read?: boolean | null
          message_type?: string | null
          receiver_id: string
          reply_to?: string | null
          sender_id: string
          subject_id?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          is_read?: boolean | null
          message_type?: string | null
          receiver_id?: string
          reply_to?: string | null
          sender_id?: string
          subject_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_link_request_history: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          link_id: string
          note: string | null
          parent_user_id: string
          requested_at: string
          status: string
          student_user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          link_id: string
          note?: string | null
          parent_user_id: string
          requested_at?: string
          status: string
          student_user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          link_id?: string
          note?: string | null
          parent_user_id?: string
          requested_at?: string
          status?: string
          student_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_link_request_history_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "parent_student_links"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_student_links: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          id: string
          parent_user_id: string
          requested_at: string
          status: string
          student_id_no: string
          student_user_id: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          parent_user_id: string
          requested_at?: string
          status?: string
          student_id_no: string
          student_user_id: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          parent_user_id?: string
          requested_at?: string
          status?: string
          student_id_no?: string
          student_user_id?: string
        }
        Relationships: []
      }
      peer_connections: {
        Row: {
          collaboration_history: string[] | null
          connection_strength: number | null
          created_at: string | null
          id: string
          peer_id: string
          recommended_by: string | null
          student_id: string
          subject_id: string | null
        }
        Insert: {
          collaboration_history?: string[] | null
          connection_strength?: number | null
          created_at?: string | null
          id?: string
          peer_id: string
          recommended_by?: string | null
          student_id: string
          subject_id?: string | null
        }
        Update: {
          collaboration_history?: string[] | null
          connection_strength?: number | null
          created_at?: string | null
          id?: string
          peer_id?: string
          recommended_by?: string | null
          student_id?: string
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "peer_connections_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          academic_performance: number | null
          activity_average: number | null
          activity_completion_rate: number | null
          assignment_average: number | null
          attendance_rate: number | null
          comprehension_rating: number | null
          confidence: number | null
          created_at: string | null
          exam_average: number | null
          final_exam_average: number | null
          id: string
          laboratory_exam_average: number | null
          midterm_exam_average: number | null
          prediction_type: string
          previous_attendance_rate: number | null
          previous_risk_level: string | null
          project_score: number | null
          quiz_average: number | null
          recommendation: string | null
          risk_level: string
          risk_score: number | null
          student_id: string | null
          subject_id: string | null
        }
        Insert: {
          academic_performance?: number | null
          activity_average?: number | null
          activity_completion_rate?: number | null
          assignment_average?: number | null
          attendance_rate?: number | null
          comprehension_rating?: number | null
          confidence?: number | null
          created_at?: string | null
          exam_average?: number | null
          final_exam_average?: number | null
          id?: string
          laboratory_exam_average?: number | null
          midterm_exam_average?: number | null
          prediction_type: string
          previous_attendance_rate?: number | null
          previous_risk_level?: string | null
          project_score?: number | null
          quiz_average?: number | null
          recommendation?: string | null
          risk_level: string
          risk_score?: number | null
          student_id?: string | null
          subject_id?: string | null
        }
        Update: {
          academic_performance?: number | null
          activity_average?: number | null
          activity_completion_rate?: number | null
          assignment_average?: number | null
          attendance_rate?: number | null
          comprehension_rating?: number | null
          confidence?: number | null
          created_at?: string | null
          exam_average?: number | null
          final_exam_average?: number | null
          id?: string
          laboratory_exam_average?: number | null
          midterm_exam_average?: number | null
          prediction_type?: string
          previous_attendance_rate?: number | null
          previous_risk_level?: string | null
          project_score?: number | null
          quiz_average?: number | null
          recommendation?: string | null
          risk_level?: string
          risk_score?: number | null
          student_id?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "predictions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: string
          created_at: string | null
          email: string
          full_name: string
          id: string
          parent_email: string | null
          parent_gmail: string | null
          student_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_status?: string
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          parent_email?: string | null
          parent_gmail?: string | null
          student_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_status?: string
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          parent_email?: string | null
          parent_gmail?: string | null
          student_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      programs: {
        Row: {
          code: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      report_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
          template_config: Json | null
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          template_config?: Json | null
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          template_config?: Json | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      staff_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_by: string
          department: string | null
          email: string
          expires_at: string
          id: string
          request_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_by: string
          department?: string | null
          email: string
          expires_at?: string
          id?: string
          request_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string
          department?: string | null
          email?: string
          expires_at?: string
          id?: string
          request_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invitations_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "staff_registration_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_registration_requests: {
        Row: {
          department: string | null
          email: string
          full_name: string
          id: string
          rejection_reason: string | null
          remarks: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          submitted_at: string
        }
        Insert: {
          department?: string | null
          email: string
          full_name: string
          id?: string
          rejection_reason?: string | null
          remarks?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          submitted_at?: string
        }
        Update: {
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          rejection_reason?: string | null
          remarks?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          submitted_at?: string
        }
        Relationships: []
      }
      student_activity: {
        Row: {
          activity_description: string | null
          activity_type: string
          created_at: string | null
          id: string
          login_timestamp: string | null
          source_id: string | null
          student_id: string
          subject_id: string | null
        }
        Insert: {
          activity_description?: string | null
          activity_type: string
          created_at?: string | null
          id?: string
          login_timestamp?: string | null
          source_id?: string | null
          student_id: string
          subject_id?: string | null
        }
        Update: {
          activity_description?: string | null
          activity_type?: string
          created_at?: string | null
          id?: string
          login_timestamp?: string | null
          source_id?: string | null
          student_id?: string
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_activity_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      student_engagement_feedback: {
        Row: {
          counselor_remarks: string | null
          created_at: string
          id: string
          message: string
          status: string
          student_id: string
          subject: string | null
        }
        Insert: {
          counselor_remarks?: string | null
          created_at?: string
          id?: string
          message: string
          status?: string
          student_id: string
          subject?: string | null
        }
        Update: {
          counselor_remarks?: string | null
          created_at?: string
          id?: string
          message?: string
          status?: string
          student_id?: string
          subject?: string | null
        }
        Relationships: []
      }
      student_engagement_summary: {
        Row: {
          ai_sessions: number
          announcements_read: number
          assignments_submitted: number
          assignments_viewed: number
          engagement_level: string
          engagement_score: number
          feedback_count: number
          last_login_at: string | null
          modules_viewed: number
          participation_count: number
          previous_engagement_level: string | null
          previous_engagement_score: number | null
          quiz_attempts: number
          student_id: string
          total_login_count: number
          total_time_spent_seconds: number
          updated_at: string | null
        }
        Insert: {
          ai_sessions?: number
          announcements_read?: number
          assignments_submitted?: number
          assignments_viewed?: number
          engagement_level?: string
          engagement_score?: number
          feedback_count?: number
          last_login_at?: string | null
          modules_viewed?: number
          participation_count?: number
          previous_engagement_level?: string | null
          previous_engagement_score?: number | null
          quiz_attempts?: number
          student_id: string
          total_login_count?: number
          total_time_spent_seconds?: number
          updated_at?: string | null
        }
        Update: {
          ai_sessions?: number
          announcements_read?: number
          assignments_submitted?: number
          assignments_viewed?: number
          engagement_level?: string
          engagement_score?: number
          feedback_count?: number
          last_login_at?: string | null
          modules_viewed?: number
          participation_count?: number
          previous_engagement_level?: string | null
          previous_engagement_score?: number | null
          quiz_attempts?: number
          student_id?: string
          total_login_count?: number
          total_time_spent_seconds?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      student_feedback: {
        Row: {
          created_at: string
          details: string | null
          id: string
          prediction_id: string | null
          reasons: string[]
          risk_level: string
          student_id: string
          subject_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          prediction_id?: string | null
          reasons?: string[]
          risk_level: string
          student_id: string
          subject_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          prediction_id?: string | null
          reasons?: string[]
          risk_level?: string
          student_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_feedback_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_feedback_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      student_login_history: {
        Row: {
          browser: string | null
          counts_as_login: boolean
          created_at: string | null
          device: string | null
          id: string
          ip_address: string | null
          login_time: string
          logout_time: string | null
          session_duration: number | null
          student_id: string
        }
        Insert: {
          browser?: string | null
          counts_as_login?: boolean
          created_at?: string | null
          device?: string | null
          id?: string
          ip_address?: string | null
          login_time?: string
          logout_time?: string | null
          session_duration?: number | null
          student_id: string
        }
        Update: {
          browser?: string | null
          counts_as_login?: boolean
          created_at?: string | null
          device?: string | null
          id?: string
          ip_address?: string | null
          login_time?: string
          logout_time?: string | null
          session_duration?: number | null
          student_id?: string
        }
        Relationships: []
      }
      student_programs: {
        Row: {
          created_at: string | null
          id: string
          is_irregular: boolean | null
          program_id: string | null
          student_id: string
          updated_at: string | null
          year_level: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_irregular?: boolean | null
          program_id?: string | null
          student_id: string
          updated_at?: string | null
          year_level?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_irregular?: boolean | null
          program_id?: string | null
          student_id?: string
          updated_at?: string | null
          year_level?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "student_programs_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      student_resource_interactions: {
        Row: {
          created_at: string | null
          feedback: string | null
          id: string
          interaction_type: string
          rating: number | null
          resource_id: string
          student_id: string
          time_spent_minutes: number | null
        }
        Insert: {
          created_at?: string | null
          feedback?: string | null
          id?: string
          interaction_type: string
          rating?: number | null
          resource_id: string
          student_id: string
          time_spent_minutes?: number | null
        }
        Update: {
          created_at?: string | null
          feedback?: string | null
          id?: string
          interaction_type?: string
          rating?: number | null
          resource_id?: string
          student_id?: string
          time_spent_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "student_resource_interactions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "learning_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      study_patterns: {
        Row: {
          activity_type: string
          completion_rate: number | null
          created_at: string | null
          difficulty_rating: number | null
          id: string
          student_id: string
          study_date: string
          study_duration_minutes: number
          subject_id: string | null
          time_of_day: string | null
        }
        Insert: {
          activity_type: string
          completion_rate?: number | null
          created_at?: string | null
          difficulty_rating?: number | null
          id?: string
          student_id: string
          study_date: string
          study_duration_minutes: number
          subject_id?: string | null
          time_of_day?: string | null
        }
        Update: {
          activity_type?: string
          completion_rate?: number | null
          created_at?: string | null
          difficulty_rating?: number | null
          id?: string
          student_id?: string
          study_date?: string
          study_duration_minutes?: number
          subject_id?: string | null
          time_of_day?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "study_patterns_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_grading_systems: {
        Row: {
          activity_weight: number
          attendance_weight: number
          created_at: string
          created_by: string
          exam_weight: number
          id: string
          project_weight: number
          subject_id: string
          updated_at: string
        }
        Insert: {
          activity_weight?: number
          attendance_weight?: number
          created_at?: string
          created_by?: string
          exam_weight?: number
          id?: string
          project_weight?: number
          subject_id: string
          updated_at?: string
        }
        Update: {
          activity_weight?: number
          attendance_weight?: number
          created_at?: string
          created_by?: string
          exam_weight?: number
          id?: string
          project_weight?: number
          subject_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_grading_systems_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: true
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          academic_year: string | null
          code: string
          created_at: string | null
          id: string
          instructor_id: string | null
          name: string
          program_id: string | null
          semester: string | null
        }
        Insert: {
          academic_year?: string | null
          code: string
          created_at?: string | null
          id?: string
          instructor_id?: string | null
          name: string
          program_id?: string | null
          semester?: string | null
        }
        Update: {
          academic_year?: string | null
          code?: string
          created_at?: string | null
          id?: string
          instructor_id?: string | null
          name?: string
          program_id?: string | null
          semester?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subjects_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          activity_id: string | null
          assessment_type: string | null
          graded_at: string | null
          graded_by: string | null
          id: string
          score: number | null
          student_id: string | null
          submitted_at: string | null
        }
        Insert: {
          activity_id?: string | null
          assessment_type?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          score?: number | null
          student_id?: string | null
          submitted_at?: string | null
        }
        Update: {
          activity_id?: string | null
          assessment_type?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          score?: number | null
          student_id?: string | null
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_inbox_notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      student_activity_logs: {
        Row: {
          activity_description: string | null
          activity_type: string | null
          created_at: string | null
          id: string | null
          login_timestamp: string | null
          source_id: string | null
          student_id: string | null
          subject_id: string | null
        }
        Insert: {
          activity_description?: string | null
          activity_type?: string | null
          created_at?: string | null
          id?: string | null
          login_timestamp?: string | null
          source_id?: string | null
          student_id?: string | null
          subject_id?: string | null
        }
        Update: {
          activity_description?: string | null
          activity_type?: string | null
          created_at?: string | null
          id?: string | null
          login_timestamp?: string | null
          source_id?: string | null
          student_id?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_activity_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      student_login_logs: {
        Row: {
          browser: string | null
          counts_as_login: boolean | null
          created_at: string | null
          device: string | null
          id: string | null
          ip_address: string | null
          login_time: string | null
          logout_time: string | null
          session_duration: number | null
          student_id: string | null
        }
        Insert: {
          browser?: string | null
          counts_as_login?: boolean | null
          created_at?: string | null
          device?: string | null
          id?: string | null
          ip_address?: string | null
          login_time?: string | null
          logout_time?: string | null
          session_duration?: number | null
          student_id?: string | null
        }
        Update: {
          browser?: string | null
          counts_as_login?: boolean | null
          created_at?: string | null
          device?: string | null
          id?: string | null
          ip_address?: string | null
          login_time?: string | null
          logout_time?: string | null
          session_duration?: number | null
          student_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_delete_user: {
        Args: { p_target_user_id: string }
        Returns: undefined
      }
      admin_review_staff_request: {
        Args: {
          p_rejection_reason?: string
          p_request_id: string
          p_status: string
        }
        Returns: string
      }
      admin_set_account_status: {
        Args: { p_status: string; p_target_user_id: string }
        Returns: undefined
      }
      check_staff_request_status: {
        Args: { p_email: string }
        Returns: {
          email_is_registered: boolean
          has_pending_request: boolean
        }[]
      }
      complete_staff_invitation: {
        Args: { p_token: string; p_user_id: string }
        Returns: undefined
      }
      create_engagement_alert: {
        Args: {
          p_alert_type: string
          p_dedupe_key: string
          p_from_level?: string
          p_from_score?: number
          p_instructor_body?: string
          p_message: string
          p_student_body?: string
          p_student_id: string
          p_title: string
          p_to_level?: string
          p_to_score?: number
        }
        Returns: string
      }
      enroll_self: { Args: { subject_id: string }; Returns: boolean }
      evaluate_engagement_alerts: {
        Args: { p_student_id: string }
        Returns: undefined
      }
      generate_learning_recommendations: {
        Args: { p_student_id: string; p_subject_id?: string }
        Returns: {
          confidence_score: number
          description: string
          id: string
          priority: string
          recommendation_type: string
          title: string
        }[]
      }
      get_staff_invitation_by_token: {
        Args: { p_token: string }
        Returns: {
          department: string
          email: string
          expires_at: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      instructor_can_view_student: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      instructor_can_view_student_subject: {
        Args: { p_student_id: string; p_subject_id: string }
        Returns: boolean
      }
      instructor_owns_activity: {
        Args: { p_activity_id: string }
        Returns: boolean
      }
      instructor_owns_subject: {
        Args: { p_subject_id: string }
        Returns: boolean
      }
      log_engagement_intervention: {
        Args: {
          p_action_type: string
          p_alert_id?: string
          p_metadata?: Json
          p_note?: string
          p_notify_student?: boolean
          p_student_id: string
        }
        Returns: string
      }
      mark_staff_invitation_accepted: {
        Args: { p_token: string }
        Returns: undefined
      }
      notify_engagement_alert_recipients: {
        Args: {
          p_instructor_body: string
          p_student_body: string
          p_student_id: string
          p_title: string
        }
        Returns: undefined
      }
      parent_request_student_link: {
        Args: { p_student_id_no: string }
        Returns: string
      }
      recompute_student_engagement: {
        Args: { p_student_id: string }
        Returns: undefined
      }
      recompute_student_engagement_internal: {
        Args: { p_student_id: string }
        Returns: undefined
      }
      resend_staff_invitation: {
        Args: { p_invitation_id: string }
        Returns: {
          department: string
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          token: string
        }[]
      }
      scan_engagement_inactivity_alerts: { Args: never; Returns: number }
      validate_parent_signup: {
        Args: { p_parent_email: string; p_student_id_no: string }
        Returns: undefined
      }
      validate_student_signup: {
        Args: { p_parent_email: string; p_student_id_no: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "student"
        | "instructor"
        | "admin"
        | "parent"
        | "guidance_counselor"
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
        "student",
        "instructor",
        "admin",
        "parent",
        "guidance_counselor",
      ],
    },
  },
} as const
