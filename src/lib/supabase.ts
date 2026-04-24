import { createClient, SupabaseClient } from "@supabase/supabase-js";

let server: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (!server) {
    const url = process.env.SUPABASE_URL;
    const secret =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !secret) {
      throw new Error(
        "SUPABASE_URL / SUPABASE_SECRET_KEY가 .env.local에 설정되지 않았습니다.",
      );
    }
    server = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return server;
}

export function hasSupabase(): boolean {
  return !!(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY)
  );
}

export type StoryAngleRow = {
  id: string;
  product_name: string;
  product_category: string | null;
  angle: string;
  hook: string | null;
  fact: string | null;
  sources: string[] | null;
  status: "idea" | "producing" | "done" | "skipped";
  created_at: string;
  updated_at: string;
};
