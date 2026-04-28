export interface WeddingProfile {
  budget: number | null;
  city: string | null;
  guest_count: number | null;
  partner1_name: string | null;
  partner2_name: string | null;
  role: string | null;
  wedding_date: string | null;
  wedding_type: string | null;
}

export interface TimelineTask {
  description: string;
  due_date: string | null;
  is_user_added: boolean;
  phase_id: string;
  phase_name: string;
  priority: string;
  status: string;
  title: string;
}

export interface Database {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      tasks: {
        Insert: TimelineTask & {
          id?: string;
          user_id: string;
        };
        Relationships: [];
        Row: TimelineTask & {
          id: string;
          user_id: string;
        };
        Update: Partial<TimelineTask> & {
          id?: string;
          user_id?: string;
        };
      };
      wedding_profiles: {
        Insert: WeddingProfile & {
          id?: string;
          user_id: string;
        };
        Relationships: [];
        Row: WeddingProfile & {
          id: string;
          user_id: string;
        };
        Update: Partial<WeddingProfile> & {
          id?: string;
          user_id?: string;
        };
      };
    };
    Views: Record<string, never>;
  };
}
