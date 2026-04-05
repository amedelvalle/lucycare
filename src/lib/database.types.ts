// ============================================================
// LUCYCARE — Tipos de base de datos (placeholder)
// ============================================================
// Este archivo será reemplazado por tipos auto-generados con:
//   npx supabase gen types typescript --project-id <project-id> > src/lib/database.types.ts
//
// Por ahora contiene tipos manuales basados en el schema para
// que el proyecto compile sin errores.
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'patient' | 'doctor' | 'assistant' | 'admin'
export type ClinicMemberRole = 'owner' | 'doctor' | 'assistant'
export type LucyStatus = 'listed_only' | 'claimed' | 'booking_enabled' | 'verified'
export type AppointmentSource = 'manual' | 'lucy_directorio' | 'lucy_seguimiento'
export type PaymentStatus = 'pending' | 'paid' | 'refunded'
export type ConsultationStatus = 'draft' | 'signed'
export type NotificationChannel = 'sms' | 'whatsapp' | 'email'
export type NotificationStatus = 'pending' | 'sent' | 'failed'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          role: UserRole
          full_name: string
          phone: string | null
          email: string | null
          avatar_url: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          role?: UserRole
          full_name: string
          phone?: string | null
          email?: string | null
          avatar_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          role?: UserRole
          full_name?: string
          phone?: string | null
          email?: string | null
          avatar_url?: string | null
          is_active?: boolean
          updated_at?: string
        }
      }
      clinics: {
        Row: {
          id: string
          owner_id: string
          name: string
          phone: string | null
          address_line: string | null
          department_id: string | null
          municipality_id: string | null
          logo_url: string | null
          timezone: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          phone?: string | null
          address_line?: string | null
          department_id?: string | null
          municipality_id?: string | null
          logo_url?: string | null
          timezone?: string
          is_active?: boolean
          created_at?: string
        }
        Update: {
          owner_id?: string
          name?: string
          phone?: string | null
          address_line?: string | null
          department_id?: string | null
          municipality_id?: string | null
          logo_url?: string | null
          timezone?: string
          is_active?: boolean
        }
      }
      doctors: {
        Row: {
          id: string
          profile_id: string
          clinic_id: string
          specialty_id: string | null
          license_number: string | null
          experience_years: number | null
          bio: string | null
          consultation_fee: number | null
          languages: string[] | null
          education: Json | null
          is_verified: boolean
          is_published: boolean
          lucy_status: LucyStatus
          booking_enabled: boolean
          tos_accepted_at: string | null
          tos_version: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          clinic_id: string
          specialty_id?: string | null
          license_number?: string | null
          experience_years?: number | null
          bio?: string | null
          consultation_fee?: number | null
          languages?: string[] | null
          education?: Json | null
          is_verified?: boolean
          is_published?: boolean
          lucy_status?: LucyStatus
          booking_enabled?: boolean
          tos_accepted_at?: string | null
          tos_version?: string | null
        }
        Update: {
          specialty_id?: string | null
          license_number?: string | null
          experience_years?: number | null
          bio?: string | null
          consultation_fee?: number | null
          languages?: string[] | null
          education?: Json | null
          is_verified?: boolean
          is_published?: boolean
          lucy_status?: LucyStatus
          booking_enabled?: boolean
          tos_accepted_at?: string | null
          tos_version?: string | null
        }
      }
      specialties: {
        Row: {
          id: string
          name: string
          icon: string | null
          is_active: boolean
        }
        Insert: {
          id?: string
          name: string
          icon?: string | null
          is_active?: boolean
        }
        Update: {
          name?: string
          icon?: string | null
          is_active?: boolean
        }
      }
      services: {
        Row: {
          id: string
          doctor_id: string
          name: string
          duration_minutes: number
          price: number | null
          is_first_visit: boolean
          is_active: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          doctor_id: string
          name: string
          duration_minutes?: number
          price?: number | null
          is_first_visit?: boolean
          is_active?: boolean
          sort_order?: number
        }
        Update: {
          name?: string
          duration_minutes?: number
          price?: number | null
          is_first_visit?: boolean
          is_active?: boolean
          sort_order?: number
        }
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
          name?: string
        }
      }
      municipalities: {
        Row: {
          id: string
          name: string
          department_id: string
          district: string | null
        }
        Insert: {
          id: string
          name: string
          department_id: string
          district?: string | null
        }
        Update: {
          name?: string
          department_id?: string
          district?: string | null
        }
      }
      doctor_images: {
        Row: {
          id: string
          doctor_id: string
          image_url: string
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          doctor_id: string
          image_url: string
          sort_order?: number
        }
        Update: {
          image_url?: string
          sort_order?: number
        }
      }
      appointment_statuses: {
        Row: {
          id: string
          name: string
          display_name: string
          color: string
          funnel_order: number
          is_final: boolean
          affects_revenue: boolean
        }
        Insert: {
          id?: string
          name: string
          display_name: string
          color: string
          funnel_order: number
          is_final: boolean
          affects_revenue: boolean
        }
        Update: {
          name?: string
          display_name?: string
          color?: string
          funnel_order?: number
          is_final?: boolean
          affects_revenue?: boolean
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: UserRole
      clinic_member_role: ClinicMemberRole
      lucy_status: LucyStatus
      appointment_source: AppointmentSource
      payment_status: PaymentStatus
      consultation_status: ConsultationStatus
    }
  }
}
