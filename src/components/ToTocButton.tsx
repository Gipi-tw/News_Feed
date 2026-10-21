"use client";
import { useEffect, useState } from "react";

// Floating "↑ 目錄" that shows up once the table of contents has scrolled out
// of view, so it never covers the top of the page.
export default function ToTocButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const toc = document.getElementById("toc");
    if (!toc) return;
    const onScroll = () => setShow(toc.getBoundingClientRect().bottom < 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!show) return null;
  return (
    <a href="#toc" className="to-toc" aria-label="回到本期目錄">
      ↑ 目錄
    </a>
  );
}
