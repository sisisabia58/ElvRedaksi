import { can, type Role } from "../auth/rbac";

export function navItems(role: Role): { href: string; label: string; group: "editor" | "admin" }[] {
  const items: { href: string; label: string; group: "editor" | "admin" }[] = [
    { href: "/overview", label: "Overview", group: "editor" },
    { href: "/review", label: "Antrian Review", group: "editor" },
    { href: "/radar", label: "Radar Topik", group: "editor" },
    { href: "/kalender", label: "Kalender", group: "editor" },
    { href: "/analitik", label: "Analitik", group: "editor" },
    { href: "/brain", label: "Brain", group: "editor" },
  ];
  if (can(role, "source.write")) {
    items.push(
      { href: "/sumber", label: "Sumber Topik", group: "admin" },
      { href: "/tim", label: "Tim & Akses", group: "admin" },
      { href: "/pengaturan", label: "Pengaturan", group: "admin" },
    );
  }
  return items;
}
