"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Command, Snapshot } from "@/supabase/functions/_shared/types";
export const backend =
  process.env.NEXT_PUBLIC_BACKEND === "supabase" ? "supabase" : "local";
let supabase: SupabaseClient | null = null,
  authentication: Promise<string> | null = null;
export function getSupabase() {
  if (backend !== "supabase") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase 연결 설정을 확인하라.");
  return (supabase ??= createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }));
}
async function token() {
  const client = getSupabase()!;
  return (authentication ??= (async () => {
    const { data } = await client.auth.getSession();
    if (data.session) return data.session.access_token;
    const { data: created, error } = await client.auth.signInAnonymously();
    if (error || !created.session)
      throw new Error("익명 세션을 만들지 못했다. 연결을 확인하라.");
    return created.session.access_token;
  })().finally(() => {
    authentication = null;
  }));
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retry_at?: number,
  ) {
    super(message);
  }
}
export async function requestGame(command: Command): Promise<Snapshot> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const endpoint =
    backend === "local"
      ? "/api/game"
      : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/game`;
  if (backend === "supabase") {
    headers.Authorization = `Bearer ${await token()}`;
    headers.apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(command),
      cache: "no-store",
      credentials: backend === "local" ? "same-origin" : "omit",
    });
  } catch {
    throw new ApiError(
      "NETWORK",
      "연결이 끊겼다. 화면은 유지된다. 다시 연결하라.",
    );
  }
  let data: Snapshot & { code?: string; message?: string; retry_at?: number };
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "NETWORK",
      "응답을 확인하지 못했다. 같은 요청으로 다시 시도하라.",
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.code ?? "SERVER_ERROR",
      data.message ?? "연결을 확인하라.",
      data.retry_at,
    );
  return data;
}
