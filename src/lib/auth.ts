import { getSupabaseServer, hasSupabase } from "@/lib/supabase";

/**
 * 팀원 인증 — 이름 기반 (Supabase team_users 테이블).
 * 클라이언트는 이름으로 입장 → 서버가 UUID(id)로 변환해 사용.
 */

export const USER_NAME_HEADER = "x-user-code";

export type TeamUser = {
  id: string;
  name: string;
  displayName: string | null;
};

export function getNameFromRequest(req: Request): string | null {
  const header = req.headers.get(USER_NAME_HEADER);
  if (!header || !header.trim()) return null;
  // 클라이언트가 URL 인코딩으로 보냈을 가능성이 있어서 디코드
  try {
    return decodeURIComponent(header.trim());
  } catch {
    return header.trim();
  }
}

export async function lookupTeamUser(
  name: string | null | undefined,
): Promise<TeamUser | null> {
  if (!name || !hasSupabase()) return null;
  try {
    const supa = getSupabaseServer();
    const { data, error } = await supa
      .from("team_users")
      .select("id, name, display_name")
      .eq("name", name.trim())
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id as string,
      name: data.name as string,
      displayName: (data.display_name as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 라우트 요청에서 인증된 팀원 객체 반환 (id 포함). 없으면 null.
 */
export async function requireTeamUser(req: Request): Promise<TeamUser | null> {
  const name = getNameFromRequest(req);
  return await lookupTeamUser(name);
}
