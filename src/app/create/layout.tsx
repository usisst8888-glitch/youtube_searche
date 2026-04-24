"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectProvider } from "./context";

const STEPS = [
  { href: "/create/research", label: "0. 제품 리서치" },
  { href: "/create/analyze", label: "1. 상품 & 대본" },
  { href: "/create/images", label: "2. 비주얼 스타일" },
  { href: "/create/scenes", label: "3. 씬 이미지" },
  { href: "/create/videos", label: "4. 씬 비디오" },
  { href: "/create/finalize", label: "5. 최종 합성" },
];

export default function CreateLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <ProjectProvider>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">✨ 쇼츠 제작</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            참고 영상으로 대본 스타일 분석 → AI로 쇼츠 자동 생성
          </p>
        </div>

        <nav className="mb-6 overflow-x-auto">
          <ol className="flex gap-2 min-w-max">
            {STEPS.map((step) => {
              const active = pathname === step.href;
              return (
                <li key={step.href}>
                  <Link
                    href={step.href}
                    className={`block px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                      active
                        ? "bg-red-500 text-white"
                        : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700"
                    }`}
                  >
                    {step.label}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <div>{children}</div>
      </div>
    </ProjectProvider>
  );
}
