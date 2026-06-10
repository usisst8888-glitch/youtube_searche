import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "YouTube 쇼츠 스튜디오",
  description: "떡상 쇼츠 탐색 + AI 쇼츠 제작 파이프라인",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950">
        <nav className="sticky top-0 z-50 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-6">
            <Link
              href="/"
              className="font-bold text-lg flex items-center gap-1"
            >
              🎬 쇼츠 스튜디오
            </Link>
            <div className="flex gap-1 text-sm">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                🔥 떡상 탐색
              </Link>
              <Link
                href="/create"
                className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ✨ 쇼츠 제작
              </Link>
              <Link
                href="/video-to-script"
                className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                🎞️ 영상→대본
              </Link>
              <Link
                href="/longform-summary"
                className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                📚 롱폼 요약
              </Link>
              <Link
                href="/shorts-playbook"
                className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                🚀 쇼츠 플레이북
              </Link>
              <Link
                href="/insta-tracker"
                className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                📡 인스타 트래커
              </Link>
              <Link
                href="/erase-subtitle"
                className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                🇨🇳 자막 제거
              </Link>
              <Link
                href="/shorts-analyzer"
                className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                🎯 소재 분석
              </Link>
            </div>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
