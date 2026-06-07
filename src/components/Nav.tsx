"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/", label: "今日" },
  { href: "/history", label: "歷史" },
  { href: "/search", label: "搜尋" },
  { href: "/settings", label: "設定" },
];

export default function Nav() {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <nav className="topnav">
      <div className="inner">
        <span className="brand">📰 內容摘要日報</span>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={path === l.href ? "active" : ""}
          >
            {l.label}
          </Link>
        ))}
        <button className="linkbtn" onClick={logout}>
          登出
        </button>
      </div>
    </nav>
  );
}
