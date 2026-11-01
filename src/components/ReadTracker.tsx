"use client";
import { useEffect } from "react";

// 閱讀紀錄: for every card marked data-eng="a:<articleId>" / "v:<videoId>",
// record whether it crossed the reading line (a thin band 40% down the
// screen), how long it sat there, and whether its links were opened or its
// text copied. Batches go to /api/engagement as beacons. No buttons: how
// Gipi reads is the feedback (src/lib/engagement.ts).

const READING_LINE = "-40% 0px -59% 0px"; // a 1%-tall band at 40% of the viewport
const TICK_MS = 1000;
const IDLE_MS = 90_000; // no scroll or tap for this long = phone put down; stop the clock
const FLUSH_MS = 60_000;

type Delta = { s: number; ms: number; c: number; p: number };

export default function ReadTracker() {
  useEffect(() => {
    const pending = new Map<string, Delta>();
    const seen = new Set<string>(); // "seen" counts once per page view
    const atLine = new Set<string>();
    let lastActive = Date.now();

    const bump = (id: string, k: keyof Delta, n = 1) => {
      const d = pending.get(id) ?? { s: 0, ms: 0, c: 0, p: 0 };
      d[k] += n;
      pending.set(id, d);
    };
    const flush = () => {
      if (!pending.size) return;
      const body = JSON.stringify({ e: [...pending].map(([id, d]) => ({ id, ...d })) });
      pending.clear();
      if (!navigator.sendBeacon?.("/api/engagement", body)) {
        fetch("/api/engagement", { method: "POST", body, keepalive: true }).catch(() => {});
      }
    };
    const cardOf = (node: Node | null | undefined) =>
      (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-eng]")?.dataset.eng;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.eng!;
          if (!e.isIntersecting) {
            atLine.delete(id);
            continue;
          }
          atLine.add(id);
          if (!seen.has(id)) {
            seen.add(id);
            bump(id, "s");
          }
        }
      },
      { rootMargin: READING_LINE },
    );
    document.querySelectorAll("[data-eng]").forEach((el) => io.observe(el));

    const tick = setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastActive > IDLE_MS || !atLine.size) return;
      // Two cards straddling the line share the second.
      for (const id of atLine) bump(id, "ms", Math.round(TICK_MS / atLine.size));
    }, TICK_MS);
    const periodic = setInterval(flush, FLUSH_MS);

    const active = () => {
      lastActive = Date.now();
    };
    const onClick = (ev: MouseEvent) => {
      active();
      const link = (ev.target as Element | null)?.closest?.("a[href]");
      const id = cardOf(link);
      if (!id) return;
      bump(id, "c");
      flush(); // the link opens a new tab; send now rather than on hide
    };
    const onCopy = () => {
      const id = cardOf(document.getSelection()?.anchorNode);
      if (id) bump(id, "p");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else active();
    };
    const activity = ["scroll", "wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const t of activity) window.addEventListener(t, active, { passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true); // middle-click = open in new tab
    document.addEventListener("copy", onCopy);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      flush();
      io.disconnect();
      clearInterval(tick);
      clearInterval(periodic);
      for (const t of activity) window.removeEventListener(t, active);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, []);
  return null;
}
