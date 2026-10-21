"use client";
import { useRouter } from "next/navigation";

// The date menu in DayPicker: picking a day opens its page.
export default function DayJump({ value, options }: { value: string; options: { href: string; label: string }[] }) {
  const router = useRouter();
  return (
    <select className="dayjump" aria-label="選擇日期" value={value} onChange={(e) => router.push(e.target.value)}>
      {!value && <option value="">選擇日期…</option>}
      {options.map((o) => (
        <option key={o.href} value={o.href}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
