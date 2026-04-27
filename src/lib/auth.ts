/**
 * 팀원 접근 코드 인증 유틸.
 * 매우 가벼운 multi-user 분리용 — 비밀번호/이메일 X.
 */

export const USER_CODE_HEADER = "x-user-code";

export function getValidCodes(): string[] {
  const raw = process.env.USER_CODES || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isValidCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const codes = getValidCodes();
  if (codes.length === 0) return false;
  return codes.includes(code);
}

export function getCodeFromRequest(req: Request): string | null {
  const header = req.headers.get(USER_CODE_HEADER);
  if (header && header.trim()) return header.trim();
  return null;
}
