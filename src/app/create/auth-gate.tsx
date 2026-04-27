"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

type AuthState = {
  code: string | null;
  setCode: (c: string | null) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "yt_studio_user_code";

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthGate");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setCodeState(saved);
    setLoaded(true);
  }, []);

  const setCode = useCallback((c: string | null) => {
    setCodeState(c);
    if (c) localStorage.setItem(STORAGE_KEY, c);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const signOut = useCallback(() => setCode(null), [setCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!input.trim()) return setError("코드를 입력하세요.");
    setPending(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "인증 실패");
        return;
      }
      setCode(data.code);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setPending(false);
    }
  };

  if (!loaded) {
    return (
      <div className="text-sm text-zinc-500 py-12 text-center">
        로딩 중...
      </div>
    );
  }

  if (!code) {
    return (
      <div className="max-w-sm mx-auto py-12">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-bold mb-1">🔐 팀원 접근 코드</h2>
          <p className="text-xs text-zinc-500 mb-4">
            관리자가 알려준 본인 코드를 입력하세요. 썰 라이브러리는
            코드별로 분리됩니다.
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="예: BAECHEOL"
              autoFocus
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={pending}
              className="w-full bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-4 py-2 rounded-lg"
            >
              {pending ? "확인 중..." : "입장"}
            </button>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                ⚠️ {error}
              </p>
            )}
          </form>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ code, setCode, signOut }}>
      <div className="mb-4 flex items-center justify-end gap-2 text-xs text-zinc-500">
        <span>
          🔐 <code className="font-mono">{code}</code>
        </span>
        <button
          type="button"
          onClick={signOut}
          className="text-blue-500 hover:underline"
        >
          로그아웃
        </button>
      </div>
      {children}
    </AuthContext.Provider>
  );
}
