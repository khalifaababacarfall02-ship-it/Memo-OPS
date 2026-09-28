// Database types for supabase-js, matching supabase/migrations.
// Keep in sync with the SQL (or regenerate with `npm run db:types` against a
// running Supabase and keep the aliases at the bottom).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          is_admin: boolean;
          asana_user_gid: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string;
          is_admin?: boolean;
          asana_user_gid?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          is_admin?: boolean;
          asana_user_gid?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      team_members: {
        Row: {
          user_id: string;
          team: Database["public"]["Enums"]["team_key"];
          created_at: string;
        };
        Insert: {
          user_id: string;
          team: Database["public"]["Enums"]["team_key"];
          created_at?: string;
        };
        Update: {
          user_id?: string;
          team?: Database["public"]["Enums"]["team_key"];
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      memos: {
        Row: {
          id: string;
          team: Database["public"]["Enums"]["team_key"];
          lang: Database["public"]["Enums"]["memo_lang"];
          title: string;
          author_id: string;
          decider_id: string | null;
          status: Database["public"]["Enums"]["memo_status"];
          content: Json;
          asana_task_gid: string | null;
          search_text: string;
          decided_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          team: Database["public"]["Enums"]["team_key"];
          lang: Database["public"]["Enums"]["memo_lang"];
          title?: string;
          author_id?: string;
          decider_id?: string | null;
          status?: Database["public"]["Enums"]["memo_status"];
          content?: Json;
          asana_task_gid?: string | null;
          search_text?: string;
          decided_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          team?: Database["public"]["Enums"]["team_key"];
          lang?: Database["public"]["Enums"]["memo_lang"];
          title?: string;
          author_id?: string;
          decider_id?: string | null;
          status?: Database["public"]["Enums"]["memo_status"];
          content?: Json;
          asana_task_gid?: string | null;
          search_text?: string;
          decided_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memos_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memos_decider_id_fkey";
            columns: ["decider_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      memo_answers: {
        Row: {
          memo_id: string;
          question_id: string;
          answer: string;
          answered_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          memo_id: string;
          question_id: string;
          answer?: string;
          answered_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          memo_id?: string;
          question_id?: string;
          answer?: string;
          answered_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memo_answers_memo_id_fkey";
            columns: ["memo_id"];
            isOneToOne: false;
            referencedRelation: "memos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memo_answers_answered_by_fkey";
            columns: ["answered_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      team_key: "ops" | "growth" | "crea" | "sav" | "finance" | "mini";
      memo_lang: "fr" | "en";
      memo_status: "draft" | "to_decide" | "decided" | "archived";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];

export type ProfileRow = Tables<"profiles">;
export type MemoRow = Tables<"memos">;
export type MemoAnswerRow = Tables<"memo_answers">;
export type TeamMemberRow = Tables<"team_members">;
