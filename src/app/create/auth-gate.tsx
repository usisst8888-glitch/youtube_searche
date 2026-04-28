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
  name: string | null;
  displayName: string | null;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

const NAME_KEY = "yt_studio_user_code"; // 헤더 키랑 호환 위해 그대로
const DISPLAY_KEY = "yt_studio_user_display";

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthGate");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const savedName = localStorage.getItem(NAME_KEY);
    const savedDisplay = localStorage.getItem(DISPLAY_KEY);
    if (savedName) setName(savedName);
    if (savedDisplay) setDisplayName(savedDisplay);
    setLoaded(true);
  }, []);

  const persist = useCallback(
    (n: string | null, d: string | null) => {
      setName(n);
      setDisplayName(d);
      if (n) localStorage.setItem(NAME_KEY, n);
      else localStorage.removeItem(NAME_KEY);
      if (d) localStorage.setItem(DISPLAY_KEY, d);
      else localStorage.removeItem(DISPLAY_KEY);
    },
    [],
  );

  const signOut = useCallback(() => persist(null, null), [persist]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!input.trim()) return setError("이름을 입력하세요.");
    setPending(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "인증 실패");
        return;
      }
      persist(data.name, data.displayName ?? null);
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

  if (!name) {
    return (
      <div className="max-w-sm mx-auto py-12">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-bold mb-1">🔐 팀원 로그인</h2>
          <p className="text-xs text-zinc-500 mb-4">
            관리자에게 등록된 본인 이름을 입력하세요. 썰 라이브러리는
            사람별로 분리됩니다.
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="본인 이름"
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
          <p className="mt-4 text-[11px] text-zinc-500">
            등록되지 않은 사람은 관리자가 Supabase{" "}
            <code className="font-mono">team_users</code> 테이블에
            추가해야 입장 가능.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ name, displayName, signOut }}>
      <div className="mb-4 flex items-center justify-end gap-2 text-xs text-zinc-500">
        <span>
          🔐 <b>{name}</b>
          {displayName && <span className="ml-1">({displayName})</span>}
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
