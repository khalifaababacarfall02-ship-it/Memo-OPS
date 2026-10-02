// Database types for supabase-js, matching supabase/migrations/ (20260928120000_memo_app.sql
// and the later rounds)
// (same shape as `supabase gen types`: Insert makes optional what has a default or is nullable).
// Keep in sync with the SQL (or regenerate with `npm run db:types` against a
// running Supabase and keep the aliases at the bottom).
//
// The types describe the tables; the guard triggers decide what a signed-in user may write:
// - memos insert: author_id = the caller, status = "draft", decided_at and asana_task_gid = null.
// - memos update: id, team, author_id, created_at never change; title, content, lang and
//   decider_id only by the author (or an admin) while draft / to_decide; status only along
//   the workflow (src/lib/memo/model.ts); decided_at, updated_at, search_text are derived.
// - memo_answers: answered_by = the caller; only the decision maker (or an admin) while to_decide.
// - profiles: id and email never change; only admins change is_admin.
// - invitations: admins only. memo_participants / memo_calls: read with the memo, written
//   by its author (or an admin) while draft / to_decide. calendar_links: its owner only.
// Error messages: see the header of the migration.

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
          onboarded_at: string | null;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string;
          is_admin?: boolean;
          asana_user_gid?: string | null;
          created_at?: string;
          updated_at?: string;
          onboarded_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          is_admin?: boolean;
          asana_user_gid?: string | null;
          created_at?: string;
          updated_at?: string;
          onboarded_at?: string | null;
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
      invitations: {
        Row: {
          email: string;
          team: Database["public"]["Enums"]["team_key"] | null;
          invited_by: string | null;
          created_at: string;
        };
        Insert: {
          email: string;
          team?: Database["public"]["Enums"]["team_key"] | null;
          invited_by?: string | null;
          created_at?: string;
        };
        Update: {
          email?: string;
          team?: Database["public"]["Enums"]["team_key"] | null;
          invited_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      memo_participants: {
        Row: {
          memo_id: string;
          email: string;
          added_by: string | null;
          created_at: string;
        };
        Insert: {
          memo_id: string;
          email: string;
          added_by?: string | null;
          created_at?: string;
        };
        Update: {
          memo_id?: string;
          email?: string;
          added_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memo_participants_memo_id_fkey";
            columns: ["memo_id"];
            isOneToOne: false;
            referencedRelation: "memos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memo_participants_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      memo_calls: {
        Row: {
          memo_id: string;
          starts_at: string | null;
          event_id: string | null;
          updated_at: string;
        };
        Insert: {
          memo_id: string;
          starts_at?: string | null;
          event_id?: string | null;
          updated_at?: string;
        };
        Update: {
          memo_id?: string;
          starts_at?: string | null;
          event_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memo_calls_memo_id_fkey";
            columns: ["memo_id"];
            isOneToOne: true;
            referencedRelation: "memos";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_links: {
        Row: {
          user_id: string;
          url: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          url: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          url?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_links_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      google_connections: {
        Row: {
          user_id: string;
          google_email: string;
          refresh_token: string;
          scope: string;
          connected_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          google_email: string;
          refresh_token: string;
          scope?: string;
          connected_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          google_email?: string;
          refresh_token?: string;
          scope?: string;
          connected_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_connections_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
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
      can_sign_in: {
        Args: { p_email: string };
        Returns: boolean;
      };
      complete_onboarding: {
        Args: { p_full_name: string; p_team?: Database["public"]["Enums"]["team_key"] | null };
        Returns: undefined;
      };
      issue_access_code: {
        Args: { p_email: string };
        Returns: string;
      };
      set_password_with_code: {
        Args: { p_email: string; p_code: string; p_password: string };
        Returns: string;
      };
      create_call_memo: {
        Args: {
          p_team: Database["public"]["Enums"]["team_key"];
          p_lang: Database["public"]["Enums"]["memo_lang"];
          p_title: string;
          p_content: Json;
          p_starts_at: string | null;
          p_event_id: string | null;
          p_emails: string[] | null;
        };
        Returns: string;
      };
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
export type InvitationRow = Tables<"invitations">;
export type MemoParticipantRow = Tables<"memo_participants">;
export type MemoCallRow = Tables<"memo_calls">;
