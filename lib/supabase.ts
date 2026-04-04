import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Browser-side client (anon key, respects RLS)
export const supabase: SupabaseClient<Database> | null =
  supabaseUrl && supabaseAnonKey
    ? createClient<Database>(supabaseUrl, supabaseAnonKey)
    : null;

// Server-side client (service role, bypasses RLS)
export function createServerClient(): SupabaseClient<Database> | null {
  return createServiceRoleClient();
}

// Explicit service-role client for admin / privileged operations.
// Uses SUPABASE_SERVICE_ROLE_KEY — never expose to the browser.
export function createServiceRoleClient(): SupabaseClient<Database> | null {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Database types
// ---------------------------------------------------------------------------

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      storylines: {
        Row: {
          id: number;
          storyline_id: number;
          writer_address: string;
          token_address: string;
          title: string;
          plot_count: number;
          last_plot_time: string | null;
          has_deadline: boolean;
          sunset: boolean;
          writer_type: number | null;
          hidden: boolean;
          tx_hash: string;
          log_index: number;
          block_timestamp: string | null;
          indexed_at: string;
          view_count: number;
          contract_address: string;
          genre: string | null;
          language: string;
        };
        Insert: {
          id?: never;
          storyline_id: number;
          writer_address: string;
          token_address: string;
          title: string;
          plot_count?: number;
          last_plot_time?: string | null;
          has_deadline?: boolean;
          sunset?: boolean;
          writer_type?: number | null;
          hidden?: boolean;
          tx_hash: string;
          log_index: number;
          block_timestamp?: string | null;
          indexed_at?: string;
          view_count?: number;
          contract_address: string;
          genre?: string | null;
          language?: string;
        };
        Update: {
          id?: never;
          storyline_id?: number;
          writer_address?: string;
          token_address?: string;
          title?: string;
          plot_count?: number;
          last_plot_time?: string | null;
          has_deadline?: boolean;
          sunset?: boolean;
          writer_type?: number | null;
          hidden?: boolean;
          tx_hash?: string;
          log_index?: number;
          block_timestamp?: string | null;
          indexed_at?: string;
          view_count?: number;
          contract_address?: string;
          genre?: string | null;
          language?: string;
        };
        Relationships: [];
      };
      page_views: {
        Row: {
          id: number;
          storyline_id: number;
          plot_index: number | null;
          viewer_address: string | null;
          session_id: string;
          viewed_at: string;
          contract_address: string;
        };
        Insert: {
          id?: never;
          storyline_id: number;
          plot_index?: number | null;
          viewer_address?: string | null;
          session_id: string;
          viewed_at?: string;
          contract_address: string;
        };
        Update: {
          id?: never;
          storyline_id?: number;
          plot_index?: number | null;
          viewer_address?: string | null;
          session_id?: string;
          viewed_at?: string;
          contract_address?: string;
        };
        Relationships: [];
      };
      plots: {
        Row: {
          id: number;
          storyline_id: number;
          plot_index: number;
          writer_address: string;
          title: string;
          content: string | null;
          content_cid: string;
          content_hash: string;
          hidden: boolean;
          tx_hash: string;
          log_index: number;
          block_timestamp: string | null;
          indexed_at: string;
          contract_address: string;
        };
        Insert: {
          id?: never;
          storyline_id: number;
          plot_index: number;
          writer_address: string;
          title?: string;
          content?: string | null;
          content_cid: string;
          content_hash: string;
          hidden?: boolean;
          tx_hash: string;
          log_index: number;
          block_timestamp?: string | null;
          indexed_at?: string;
          contract_address: string;
        };
        Update: {
          id?: never;
          storyline_id?: number;
          plot_index?: number;
          writer_address?: string;
          title?: string;
          content?: string | null;
          content_cid?: string;
          content_hash?: string;
          hidden?: boolean;
          tx_hash?: string;
          log_index?: number;
          block_timestamp?: string | null;
          indexed_at?: string;
          contract_address?: string;
        };
        Relationships: [];
      };
      comments: {
        Row: {
          id: number;
          storyline_id: number;
          plot_index: number;
          commenter_address: string;
          content: string;
          created_at: string;
          hidden: boolean;
          contract_address: string;
        };
        Insert: {
          id?: never;
          storyline_id: number;
          plot_index: number;
          commenter_address: string;
          content: string;
          created_at?: string;
          hidden?: boolean;
          contract_address: string;
        };
        Update: {
          id?: never;
          storyline_id?: number;
          plot_index?: number;
          commenter_address?: string;
          content?: string;
          created_at?: string;
          hidden?: boolean;
          contract_address?: string;
        };
        Relationships: [];
      };
      donations: {
        Row: {
          id: number;
          storyline_id: number;
          donor_address: string;
          amount: string;
          tx_hash: string;
          log_index: number;
          block_timestamp: string | null;
          indexed_at: string;
          contract_address: string;
        };
        Insert: {
          id?: never;
          storyline_id: number;
          donor_address: string;
          amount: string;
          tx_hash: string;
          log_index: number;
          block_timestamp?: string | null;
          indexed_at?: string;
          contract_address: string;
        };
        Update: {
          id?: never;
          storyline_id?: number;
          donor_address?: string;
          amount?: string;
          tx_hash?: string;
          log_index?: number;
          block_timestamp?: string | null;
          indexed_at?: string;
          contract_address?: string;
        };
        Relationships: [];
      };
      ratings: {
        Row: {
          id: number;
          storyline_id: number;
          rater_address: string;
          rating: number;
          comment: string | null;
          created_at: string;
          updated_at: string;
          contract_address: string;
        };
        Insert: {
          id?: never;
          storyline_id: number;
          rater_address: string;
          rating: number;
          comment?: string | null;
          created_at?: string;
          updated_at?: string;
          contract_address: string;
        };
        Update: {
          id?: never;
          storyline_id?: number;
          rater_address?: string;
          rating?: number;
          comment?: string | null;
          created_at?: string;
          updated_at?: string;
          contract_address?: string;
        };
        Relationships: [];
      };
      backfill_cursor: {
        Row: {
          id: number;
          last_block: number;
          updated_at: string;
        };
        Insert: {
          id?: number;
          last_block: number;
          updated_at?: string;
        };
        Update: {
          id?: number;
          last_block?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      backfill_failures: {
        Row: {
          id: number;
          tx_hash: string;
          log_index: number;
          block_number: number;
          event_name: string;
          storyline_id: number;
          reason: string;
          created_at: string;
        };
        Insert: {
          id?: never;
          tx_hash: string;
          log_index: number;
          block_number: number;
          event_name: string;
          storyline_id: number;
          reason: string;
          created_at?: string;
        };
        Update: {
          id?: never;
          tx_hash?: string;
          log_index?: number;
          block_number?: number;
          event_name?: string;
          storyline_id?: number;
          reason?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      trade_history: {
        Row: {
          id: number;
          token_address: string;
          storyline_id: number;
          event_type: string;
          price_per_token: number;
          total_supply: number;
          reserve_amount: number;
          block_number: number;
          block_timestamp: string;
          tx_hash: string;
          log_index: number;
          contract_address: string;
          user_address: string | null;
          reserve_usd_rate: number | null;
          rate_source: string | null;
        };
        Insert: {
          id?: never;
          token_address: string;
          storyline_id: number;
          event_type: string;
          price_per_token: number;
          total_supply: number;
          reserve_amount: number;
          block_number: number;
          block_timestamp: string;
          tx_hash: string;
          log_index: number;
          contract_address: string;
          user_address?: string | null;
          reserve_usd_rate?: number | null;
          rate_source?: string | null;
        };
        Update: {
          id?: never;
          token_address?: string;
          storyline_id?: number;
          event_type?: string;
          price_per_token?: number;
          total_supply?: number;
          reserve_amount?: number;
          block_number?: number;
          block_timestamp?: string;
          tx_hash?: string;
          log_index?: number;
          contract_address?: string;
          user_address?: string | null;
          reserve_usd_rate?: number | null;
          rate_source?: string | null;
        };
        Relationships: [];
      };
      users: {
      Row: {
        id: string;
        fid: number | null;
        username: string | null;
        display_name: string | null;
        pfp_url: string | null;
        custody_address: string | null;
        verified_addresses: string[] | null;
        primary_address: string | null;
        bio: string | null;
        url: string | null;
        location: string | null;
        twitter: string | null;
        github: string | null;
        follower_count: number;
        following_count: number;
        power_badge: boolean | null;
        is_pro_subscriber: boolean | null;
        neynar_score: number | null;
        spam_label: number | null;
        fc_created_at: string | null;
        x_followers_count: number | null;
        x_following_count: number | null;
        x_verified: boolean | null;
        x_display_name: string | null;
        x_stats_fetched_at: string | null;
        quotient_score: number | null;
        quotient_rank: number | null;
        quotient_labels: Json | null;
        quotient_updated_at: string | null;
        agent_id: number | null;
        agent_name: string | null;
        agent_description: string | null;
        agent_genre: string | null;
        agent_llm_model: string | null;
        agent_wallet: string | null;
        agent_owner: string | null;
        agent_registered_at: string | null;
        stats_fetched_at: string | null;
        steemhunt_fetched_at: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: never;
        fid?: number | null;
        username?: string | null;
        display_name?: string | null;
        pfp_url?: string | null;
        custody_address?: string | null;
        verified_addresses?: string[] | null;
        primary_address?: string | null;
        bio?: string | null;
        url?: string | null;
        location?: string | null;
        twitter?: string | null;
        github?: string | null;
        follower_count?: number;
        following_count?: number;
        power_badge?: boolean | null;
        is_pro_subscriber?: boolean | null;
        neynar_score?: number | null;
        spam_label?: number | null;
        fc_created_at?: string | null;
        x_followers_count?: number | null;
        x_following_count?: number | null;
        x_verified?: boolean | null;
        x_display_name?: string | null;
        x_stats_fetched_at?: string | null;
        quotient_score?: number | null;
        quotient_rank?: number | null;
        quotient_labels?: Json | null;
        quotient_updated_at?: string | null;
        agent_id?: number | null;
        agent_name?: string | null;
        agent_description?: string | null;
        agent_genre?: string | null;
        agent_llm_model?: string | null;
        agent_wallet?: string | null;
        agent_owner?: string | null;
        agent_registered_at?: string | null;
        stats_fetched_at?: string | null;
        steemhunt_fetched_at?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: never;
        fid?: number | null;
        username?: string | null;
        display_name?: string | null;
        pfp_url?: string | null;
        custody_address?: string | null;
        verified_addresses?: string[] | null;
        primary_address?: string | null;
        bio?: string | null;
        url?: string | null;
        location?: string | null;
        twitter?: string | null;
        github?: string | null;
        follower_count?: number;
        following_count?: number;
        power_badge?: boolean | null;
        is_pro_subscriber?: boolean | null;
        neynar_score?: number | null;
        spam_label?: number | null;
        fc_created_at?: string | null;
        x_followers_count?: number | null;
        x_following_count?: number | null;
        x_verified?: boolean | null;
        x_display_name?: string | null;
        x_stats_fetched_at?: string | null;
        quotient_score?: number | null;
        quotient_rank?: number | null;
        quotient_labels?: Json | null;
        quotient_updated_at?: string | null;
        agent_id?: number | null;
        agent_name?: string | null;
        agent_description?: string | null;
        agent_genre?: string | null;
        agent_llm_model?: string | null;
        agent_wallet?: string | null;
        agent_owner?: string | null;
        agent_registered_at?: string | null;
        stats_fetched_at?: string | null;
        steemhunt_fetched_at?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    agent_wallets: {
      Row: {
        id: string;
        user_id: string;
        wallet_id: string;
        wallet_name: string;
        address_base: string;
        api_key_id: string | null;
        policy_ids: string[];
        spend_cap_usdc: number;
        created_at: string;
        is_active: boolean;
      };
      Insert: {
        id?: string;
        user_id: string;
        wallet_id: string;
        wallet_name: string;
        address_base: string;
        api_key_id?: string | null;
        policy_ids?: string[];
        spend_cap_usdc?: number;
        created_at?: string;
        is_active?: boolean;
      };
      Update: {
        id?: string;
        user_id?: string;
        wallet_id?: string;
        wallet_name?: string;
        address_base?: string;
        api_key_id?: string | null;
        policy_ids?: string[];
        spend_cap_usdc?: number;
        created_at?: string;
        is_active?: boolean;
      };
      Relationships: [];
    };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      increment_view_count: {
        Args: { sid: number; caddr: string };
        Returns: void;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// Convenience type aliases
export type Storyline = Database["public"]["Tables"]["storylines"]["Row"];
export type Plot = Database["public"]["Tables"]["plots"]["Row"];
export type Donation = Database["public"]["Tables"]["donations"]["Row"];
export type Rating = Database["public"]["Tables"]["ratings"]["Row"];
export type Comment = Database["public"]["Tables"]["comments"]["Row"];
export type TradeHistory = Database["public"]["Tables"]["trade_history"]["Row"];
export type User = Database["public"]["Tables"]["users"]["Row"];
