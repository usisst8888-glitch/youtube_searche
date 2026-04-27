"use client";

const STORAGE_KEY = "yt_studio_user_code";

export function getStoredCode(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

/**
 * Authenticated fetch — 자동으로 X-User-Code 헤더 첨부.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const code = getStoredCode();
  const headers = new Headers(init.headers || {});
  if (code) headers.set("x-user-code", code);
  return fetch(input, { ...init, headers });
}
