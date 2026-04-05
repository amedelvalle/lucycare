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
      appointment_reasons: {
        Row: {
          doctor_id: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          doctor_id: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          doctor_id?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reasons_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_statuses: {
        Row: {
          affects_revenue: boolean
          color: string
          display_name: string
          funnel_order: number
          id: string
          is_final: boolean
          name: string
        }
        Insert: {
          affects_revenue: boolean
          color: string
          display_name: string
          funnel_order: number
          id?: string
          is_final: boolean
          name: string
        }
        Update: {
          affects_revenue?: boolean
          color?: string
          display_name?: string
          funnel_order?: number
          id?: string
          is_final?: boolean
          name?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          cancel_reason_id: string | null
          clinic_id: string
          consultation_ended_at: string | null
          consultation_started_at: string | null
          created_at: string
          created_by: string | null
          doctor_id: string
          end_time: string
          id: string
          internal_notes: string | null
          notes: string | null
          patient_id: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          price: number | null
          reason_id: string | null
          service_id: string | null
          source: Database["public"]["Enums"]["appointment_source"]
          start_time: string
          status_id: string
          stripe_payment_id: string | null
          updated_at: string
        }
        Insert: {
          cancel_reason_id?: string | null
          clinic_id: string
          consultation_ended_at?: string | null
          consultation_started_at?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id: string
          end_time: string
          id?: string
          internal_notes?: string | null
          notes?: string | null
          patient_id: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          price?: number | null
          reason_id?: string | null
          service_id?: string | null
          source?: Database["public"]["Enums"]["appointment_source"]
          start_time: string
          status_id: string
          stripe_payment_id?: string | null
          updated_at?: string
        }
        Update: {
          cancel_reason_id?: string | null
          clinic_id?: string
          consultation_ended_at?: string | null
          consultation_started_at?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: string
          end_time?: string
          id?: string
          internal_notes?: string | null
          notes?: string | null
          patient_id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          price?: number | null
          reason_id?: string | null
          service_id?: string | null
          source?: Database["public"]["Enums"]["appointment_source"]
          start_time?: string
          status_id?: string
          stripe_payment_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_cancel_reason_id_fkey"
            columns: ["cancel_reason_id"]
            isOneToOne: false
            referencedRelation: "cancel_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "appointment_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "appointment_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at: string
          id: number
          ip_address: unknown
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          id?: number
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          id?: number
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string
        }
        Relationships: []
      }
      availability_overrides: {
        Row: {
          block_type_id: string | null
          clinic_id: string
          created_at: string
          created_by: string | null
          date_end: string
          date_start: string
          description: string | null
          doctor_id: string
          id: string
          is_blocked: boolean
          time_end: string | null
          time_start: string | null
        }
        Insert: {
          block_type_id?: string | null
          clinic_id: string
          created_at?: string
          created_by?: string | null
          date_end: string
          date_start: string
          description?: string | null
          doctor_id: string
          id?: string
          is_blocked?: boolean
          time_end?: string | null
          time_start?: string | null
        }
        Update: {
          block_type_id?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          date_end?: string
          date_start?: string
          description?: string | null
          doctor_id?: string
          id?: string
          is_blocked?: boolean
          time_end?: string | null
          time_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_overrides_block_type_id_fkey"
            columns: ["block_type_id"]
            isOneToOne: false
            referencedRelation: "block_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_overrides_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_overrides_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          clinic_id: string
          day_of_week: number
          doctor_id: string
          end_time: string
          id: string
          is_active: boolean
          slot_duration_min: number
          start_time: string
        }
        Insert: {
          clinic_id: string
          day_of_week: number
          doctor_id: string
          end_time: string
          id?: string
          is_active?: boolean
          slot_duration_min?: number
          start_time: string
        }
        Update: {
          clinic_id?: string
          day_of_week?: number
          doctor_id?: string
          end_time?: string
          id?: string
          is_active?: boolean
          slot_duration_min?: number
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_rules_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      block_types: {
        Row: {
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      cancel_reasons: {
        Row: {
          category: Database["public"]["Enums"]["cancel_reason_category"]
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          category: Database["public"]["Enums"]["cancel_reason_category"]
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          category?: Database["public"]["Enums"]["cancel_reason_category"]
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      clinic_members: {
        Row: {
          clinic_id: string
          id: string
          is_active: boolean
          joined_at: string
          profile_id: string
          role: Database["public"]["Enums"]["clinic_member_role"]
        }
        Insert: {
          clinic_id: string
          id?: string
          is_active?: boolean
          joined_at?: string
          profile_id: string
          role: Database["public"]["Enums"]["clinic_member_role"]
        }
        Update: {
          clinic_id?: string
          id?: string
          is_active?: boolean
          joined_at?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["clinic_member_role"]
        }
        Relationships: [
          {
            foreignKeyName: "clinic_members_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          address_line: string | null
          created_at: string
          department_id: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          municipality_id: string | null
          name: string
          owner_id: string
          phone: string | null
          timezone: string
        }
        Insert: {
          address_line?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          municipality_id?: string | null
          name: string
          owner_id: string
          phone?: string | null
          timezone?: string
        }
        Update: {
          address_line?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          municipality_id?: string | null
          name?: string
          owner_id?: string
          phone?: string | null
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinics_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_clinics_department"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_clinics_municipality"
            columns: ["municipality_id"]
            isOneToOne: false
            referencedRelation: "municipalities"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_diagnoses: {
        Row: {
          consultation_id: string
          diagnosis_id: string
          diagnosis_status: Database["public"]["Enums"]["diagnosis_status"]
          diagnosis_type: Database["public"]["Enums"]["diagnosis_type"]
          id: string
          notes: string | null
        }
        Insert: {
          consultation_id: string
          diagnosis_id: string
          diagnosis_status?: Database["public"]["Enums"]["diagnosis_status"]
          diagnosis_type?: Database["public"]["Enums"]["diagnosis_type"]
          id?: string
          notes?: string | null
        }
        Update: {
          consultation_id?: string
          diagnosis_id?: string
          diagnosis_status?: Database["public"]["Enums"]["diagnosis_status"]
          diagnosis_type?: Database["public"]["Enums"]["diagnosis_type"]
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultation_diagnoses_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_diagnoses_diagnosis_id_fkey"
            columns: ["diagnosis_id"]
            isOneToOne: false
            referencedRelation: "diagnoses"
            referencedColumns: ["id"]
          },
        ]
      }
      consultations: {
        Row: {
          appointment_id: string | null
          chief_complaint: string | null
          clinic_id: string
          created_at: string
          doctor_id: string
          family_history_notes: string | null
          history_present_illness: string | null
          id: string
          internal_analysis: string | null
          patient_id: string
          physical_exam: string | null
          plan: string | null
          signed_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["consultation_status"]
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          chief_complaint?: string | null
          clinic_id: string
          created_at?: string
          doctor_id: string
          family_history_notes?: string | null
          history_present_illness?: string | null
          id?: string
          internal_analysis?: string | null
          patient_id: string
          physical_exam?: string | null
          plan?: string | null
          signed_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["consultation_status"]
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          chief_complaint?: string | null
          clinic_id?: string
          created_at?: string
          doctor_id?: string
          family_history_notes?: string | null
          history_present_illness?: string | null
          id?: string
          internal_analysis?: string | null
          patient_id?: string
          physical_exam?: string | null
          plan?: string | null
          signed_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["consultation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      diagnoses: {
        Row: {
          created_at: string
          description: string | null
          doctor_id: string
          id: string
          is_active: boolean
          name: string
          usage_count: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          doctor_id: string
          id?: string
          is_active?: boolean
          name: string
          usage_count?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          doctor_id?: string
          id?: string
          is_active?: boolean
          name?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "diagnoses_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_images: {
        Row: {
          created_at: string
          doctor_id: string
          id: string
          image_url: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          doctor_id: string
          id?: string
          image_url: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          doctor_id?: string
          id?: string
          image_url?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_images_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          bio: string | null
          booking_enabled: boolean
          clinic_id: string
          consultation_fee: number | null
          created_at: string
          education: Json | null
          experience_years: number | null
          id: string
          is_published: boolean
          is_verified: boolean
          languages: string[] | null
          license_number: string | null
          lucy_status: Database["public"]["Enums"]["lucy_status"]
          profile_id: string
          specialty_id: string | null
          tos_accepted_at: string | null
          tos_version: string | null
          updated_at: string
        }
        Insert: {
          bio?: string | null
          booking_enabled?: boolean
          clinic_id: string
          consultation_fee?: number | null
          created_at?: string
          education?: Json | null
          experience_years?: number | null
          id?: string
          is_published?: boolean
          is_verified?: boolean
          languages?: string[] | null
          license_number?: string | null
          lucy_status?: Database["public"]["Enums"]["lucy_status"]
          profile_id: string
          specialty_id?: string | null
          tos_accepted_at?: string | null
          tos_version?: string | null
          updated_at?: string
        }
        Update: {
          bio?: string | null
          booking_enabled?: boolean
          clinic_id?: string
          consultation_fee?: number | null
          created_at?: string
          education?: Json | null
          experience_years?: number | null
          id?: string
          is_published?: boolean
          is_verified?: boolean
          languages?: string[] | null
          license_number?: string | null
          lucy_status?: Database["public"]["Enums"]["lucy_status"]
          profile_id?: string
          specialty_id?: string | null
          tos_accepted_at?: string | null
          tos_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctors_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctors_specialty_id_fkey"
            columns: ["specialty_id"]
            isOneToOne: false
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
        ]
      }
      medications: {
        Row: {
          active_ingredient: string | null
          commercial_name: string
          concentration: string | null
          created_at: string
          doctor_id: string
          id: string
          is_active: boolean
          presentation:
            | Database["public"]["Enums"]["medication_presentation"]
            | null
          usage_count: number
        }
        Insert: {
          active_ingredient?: string | null
          commercial_name: string
          concentration?: string | null
          created_at?: string
          doctor_id: string
          id?: string
          is_active?: boolean
          presentation?:
            | Database["public"]["Enums"]["medication_presentation"]
            | null
          usage_count?: number
        }
        Update: {
          active_ingredient?: string | null
          commercial_name?: string
          concentration?: string | null
          created_at?: string
          doctor_id?: string
          id?: string
          is_active?: boolean
          presentation?:
            | Database["public"]["Enums"]["medication_presentation"]
            | null
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "medications_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      municipalities: {
        Row: {
          department_id: string
          district: string | null
          id: string
          name: string
        }
        Insert: {
          department_id: string
          district?: string | null
          id: string
          name: string
        }
        Update: {
          department_id?: string
          district?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "municipalities_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          appointment_id: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          clinic_id: string | null
          content: string
          created_at: string
          error_message: string | null
          id: string
          recipient_id: string
          recipient_phone: string | null
          scheduled_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          appointment_id?: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          clinic_id?: string | null
          content: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_id: string
          recipient_phone?: string | null
          scheduled_at: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          appointment_id?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          clinic_id?: string | null
          content?: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_id?: string
          recipient_phone?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          allergies: string | null
          blood_type: Database["public"]["Enums"]["blood_type"] | null
          clinic_id: string
          created_at: string
          date_of_birth: string
          document_number: string
          document_type: Database["public"]["Enums"]["document_type"]
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relation: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"]
          id: string
          is_active: boolean
          notes: string | null
          patient_type: Database["public"]["Enums"]["patient_type"]
          phone: string | null
          photo_url: string | null
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          allergies?: string | null
          blood_type?: Database["public"]["Enums"]["blood_type"] | null
          clinic_id: string
          created_at?: string
          date_of_birth: string
          document_number: string
          document_type?: Database["public"]["Enums"]["document_type"]
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"]
          id?: string
          is_active?: boolean
          notes?: string | null
          patient_type?: Database["public"]["Enums"]["patient_type"]
          phone?: string | null
          photo_url?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          allergies?: string | null
          blood_type?: Database["public"]["Enums"]["blood_type"] | null
          clinic_id?: string
          created_at?: string
          date_of_birth?: string
          document_number?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"]
          id?: string
          is_active?: boolean
          notes?: string | null
          patient_type?: Database["public"]["Enums"]["patient_type"]
          phone?: string | null
          photo_url?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          alternatives: string | null
          consultation_id: string
          dosage: string | null
          duration_unit: Database["public"]["Enums"]["duration_unit"] | null
          duration_value: number | null
          frequency: string | null
          id: string
          instructions: string | null
          medication_id: string
        }
        Insert: {
          alternatives?: string | null
          consultation_id: string
          dosage?: string | null
          duration_unit?: Database["public"]["Enums"]["duration_unit"] | null
          duration_value?: number | null
          frequency?: string | null
          id?: string
          instructions?: string | null
          medication_id: string
        }
        Update: {
          alternatives?: string | null
          consultation_id?: string
          dosage?: string | null
          duration_unit?: Database["public"]["Enums"]["duration_unit"] | null
          duration_value?: number | null
          frequency?: string | null
          id?: string
          instructions?: string | null
          medication_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          appointment_id: string | null
          comment: string | null
          created_at: string
          doctor_id: string
          id: string
          is_visible: boolean
          patient_profile_id: string
          rating: number
        }
        Insert: {
          appointment_id?: string | null
          comment?: string | null
          created_at?: string
          doctor_id: string
          id?: string
          is_visible?: boolean
          patient_profile_id: string
          rating: number
        }
        Update: {
          appointment_id?: string | null
          comment?: string | null
          created_at?: string
          doctor_id?: string
          id?: string
          is_visible?: boolean
          patient_profile_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "reviews_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_patient_profile_id_fkey"
            columns: ["patient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          doctor_id: string
          duration_minutes: number
          id: string
          is_active: boolean
          is_first_visit: boolean
          name: string
          price: number | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          doctor_id: string
          duration_minutes?: number
          id?: string
          is_active?: boolean
          is_first_visit?: boolean
          name: string
          price?: number | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          doctor_id?: string
          duration_minutes?: number
          id?: string
          is_active?: boolean
          is_first_visit?: boolean
          name?: string
          price?: number | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "services_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
        ]
      }
      specialties: {
        Row: {
          icon: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      vitals: {
        Row: {
          appointment_id: string
          bmi: number | null
          diastolic_bp: number | null
          heart_rate: number | null
          height_cm: number | null
          id: string
          patient_id: string
          recorded_at: string
          recorded_by: string | null
          respiratory_rate: number | null
          spo2: number | null
          systolic_bp: number | null
          temperature: number | null
          weight_lb: number | null
        }
        Insert: {
          appointment_id: string
          bmi?: number | null
          diastolic_bp?: number | null
          heart_rate?: number | null
          height_cm?: number | null
          id?: string
          patient_id: string
          recorded_at?: string
          recorded_by?: string | null
          respiratory_rate?: number | null
          spo2?: number | null
          systolic_bp?: number | null
          temperature?: number | null
          weight_lb?: number | null
        }
        Update: {
          appointment_id?: string
          bmi?: number | null
          diastolic_bp?: number | null
          heart_rate?: number | null
          height_cm?: number | null
          id?: string
          patient_id?: string
          recorded_at?: string
          recorded_by?: string | null
          respiratory_rate?: number | null
          spo2?: number | null
          systolic_bp?: number | null
          temperature?: number | null
          weight_lb?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vitals_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_recorded_by_fkey"
            columns: ["recorded_by"]
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
      get_user_clinic_ids: { Args: never; Returns: string[] }
      get_user_doctor_id: { Args: never; Returns: string }
      get_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_clinic_member: { Args: { p_clinic_id: string }; Returns: boolean }
      is_clinic_member_with_role: {
        Args: {
          p_clinic_id: string
          p_role: Database["public"]["Enums"]["clinic_member_role"]
        }
        Returns: boolean
      }
    }
    Enums: {
      appointment_source: "manual" | "lucy_directorio" | "lucy_seguimiento"
      audit_action: "select" | "insert" | "update" | "delete"
      blood_type:
        | "A+"
        | "A-"
        | "B+"
        | "B-"
        | "AB+"
        | "AB-"
        | "O+"
        | "O-"
        | "desconocido"
      cancel_reason_category: "paciente" | "medico" | "sistema"
      clinic_member_role: "owner" | "doctor" | "assistant"
      consultation_status: "draft" | "signed"
      diagnosis_status:
        | "activo"
        | "resuelto"
        | "en_tratamiento"
        | "cronico"
        | "en_observacion"
      diagnosis_type: "presuntivo" | "definitivo" | "diferencial"
      document_type:
        | "dui"
        | "partida_nacimiento"
        | "pasaporte"
        | "carnet_residente"
      duration_unit: "dias" | "semanas" | "meses" | "permanente"
      gender_type: "masculino" | "femenino" | "otro"
      lucy_status: "listed_only" | "claimed" | "booking_enabled" | "verified"
      medication_presentation:
        | "tableta"
        | "capsula"
        | "jarabe"
        | "inyectable"
        | "crema"
        | "gotas"
        | "suspension"
        | "parche"
        | "inhalador"
        | "supositorio"
        | "otro"
      notification_channel: "sms" | "whatsapp" | "email"
      notification_status: "pending" | "sent" | "failed"
      notification_type:
        | "reminder_24h"
        | "confirmation"
        | "cancellation"
        | "new_booking"
      patient_type: "privado" | "asegurado"
      payment_status: "pending" | "paid" | "refunded"
      user_role: "patient" | "doctor" | "assistant" | "admin"
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
      appointment_source: ["manual", "lucy_directorio", "lucy_seguimiento"],
      audit_action: ["select", "insert", "update", "delete"],
      blood_type: [
        "A+",
        "A-",
        "B+",
        "B-",
        "AB+",
        "AB-",
        "O+",
        "O-",
        "desconocido",
      ],
      cancel_reason_category: ["paciente", "medico", "sistema"],
      clinic_member_role: ["owner", "doctor", "assistant"],
      consultation_status: ["draft", "signed"],
      diagnosis_status: [
        "activo",
        "resuelto",
        "en_tratamiento",
        "cronico",
        "en_observacion",
      ],
      diagnosis_type: ["presuntivo", "definitivo", "diferencial"],
      document_type: [
        "dui",
        "partida_nacimiento",
        "pasaporte",
        "carnet_residente",
      ],
      duration_unit: ["dias", "semanas", "meses", "permanente"],
      gender_type: ["masculino", "femenino", "otro"],
      lucy_status: ["listed_only", "claimed", "booking_enabled", "verified"],
      medication_presentation: [
        "tableta",
        "capsula",
        "jarabe",
        "inyectable",
        "crema",
        "gotas",
        "suspension",
        "parche",
        "inhalador",
        "supositorio",
        "otro",
      ],
      notification_channel: ["sms", "whatsapp", "email"],
      notification_status: ["pending", "sent", "failed"],
      notification_type: [
        "reminder_24h",
        "confirmation",
        "cancellation",
        "new_booking",
      ],
      patient_type: ["privado", "asegurado"],
      payment_status: ["pending", "paid", "refunded"],
      user_role: ["patient", "doctor", "assistant", "admin"],
    },
  },
} as const
