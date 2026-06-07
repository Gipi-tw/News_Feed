import type { Metadata } from "next";
import "./globals.css";
import { getSession } from "@/lib/auth";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "內容摘要日報",
  description: "游舒帆個人內容爬蟲與摘要日報",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  return (
    <html lang="zh-Hant">
      <body>
        {user ? <Nav /> : null}
        {children}
      </body>
    </html>
  );
}
