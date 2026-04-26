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
      predictions: {
        Row: {
          activity_completion_rate: number | null
          assignment_average: number | null
          attendance_rate: number | null
          confidence: number | null
          created_at: string | null
          id: string
          prediction_type: string
          project_score: number | null
          quiz_average: number | null
          recommendation: string | null
          risk_level: string
          student_id: string | null
          subject_id: string | null
        }
        Insert: {
          activity_completion_rate?: number | null
          assignment_average?: number | null
          attendance_rate?: number | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          prediction_type: string
          project_score?: number | null
          quiz_average?: number | null
          recommendation?: string | null
          risk_level: string
          student_id?: string | null
          subject_id?: string | null
        }
        Update: {
          activity_completion_rate?: number | null
          assignment_average?: number | null
          attendance_rate?: number | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          prediction_type?: string
          project_score?: number | null
          quiz_average?: number | null
          recommendation?: string | null
          risk_level?: string
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
          graded_at: string | null
          graded_by: string | null
          id: string
          score: number | null
          student_id: string | null
          submitted_at: string | null
        }
        Insert: {
          activity_id?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          score?: number | null
          student_id?: string | null
          submitted_at?: string | null
        }
        Update: {
          activity_id?: string | null
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
      [_ in never]: never
    }
    Functions: {
      admin_set_account_status: {
        Args: {
          p_status: string
          p_target_user_id: string
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "student" | "instructor" | "admin" | "parent"
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
      app_role: ["student", "instructor", "admin", "parent"],
    },
  },
} as const
