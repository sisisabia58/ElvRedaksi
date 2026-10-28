"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export type NavItem = { href: string; label: string; group: "editor" | "admin" };

export function StudioNavLinks({
  items,
  reviewCount,
  orientation = "vertical",
}: {
  items: NavItem[];
  reviewCount: number;
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();

  const linkClass = (href: string) =>
    cn(
      "text-sm transition-colors whitespace-nowrap",
      pathname === href || pathname.startsWith(`${href}/`)
        ? "text-[var(--accent)]"
        : "text-[var(--muted)] hover:text-[var(--ink)]",
    );

  const listClass =
    orientation === "horizontal"
      ? "flex gap-2 overflow-x-auto pb-1 px-4"
      : "flex flex-col gap-1 px-3";

  return (
    <nav className={listClass}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={cn(linkClass(item.href), "flex items-center gap-2 py-1.5 px-2 rounded-md")}>
          <span>{item.label}</span>
          {item.href === "/review" && reviewCount > 0 ? (
            <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-[var(--bg)]">
              {reviewCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
