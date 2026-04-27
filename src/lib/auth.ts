import { getSupabaseServer, hasSupabase } from "@/lib/supabase";

/**
 * 팀원 인증 — 이름 기반 (Supabase team_users 테이블).
 * 매우 가벼운 multi-user 분리용 — 비밀번호/이메일 X.
 */

export const USER_NAME_HEADER = "x-user-code";

export type TeamUser = {
  name: string;
  displayName: string | null;
};

export function getNameFromRequest(req: Request): string | null {
  const header = req.headers.get(USER_NAME_HEADER);
  if (header && header.trim()) return header.trim();
  return null;
}

/**
 * DB에서 이름 검증. 등록되어 있으면 해당 user 객체, 아니면 null.
 */
export async function lookupTeamUser(
  name: string | null | undefined,
): Promise<TeamUser | null> {
  if (!name || !hasSupabase()) return null;
  try {
    const supa = getSupabaseServer();
    const { data, error } = await supa
      .from("team_users")
      .select("name, display_name")
      .eq("name", name.trim())
      .maybeSingle();
    if (error || !data) return null;
    return {
      name: data.name as string,
      displayName: (data.display_name as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 라우트 요청에서 인증된 사용자 이름을 가져옴 (없으면 null).
 */
export async function requireTeamUser(req: Request): Promise<string | null> {
  const name = getNameFromRequest(req);
  const user = await lookupTeamUser(name);
  return user?.name ?? null;
}
