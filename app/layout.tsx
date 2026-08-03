import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "拾音 AI｜MiniMax 智能会议听记",
  description: "录音、转写、总结与行动项一体化的 AI 会议助手原型。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><link rel="icon" href="/favicon.svg" type="image/svg+xml" /></head>
      <body>{children}</body>
    </html>
  );
}
