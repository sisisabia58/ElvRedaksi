"use client";

import { useState } from "react";
import { calculator, formatIdr, roles, type SalaryMonths } from "@/src/marketing/content";

const OPTIONS: { months: SalaryMonths; label: string }[] = [
  { months: 3, label: "3 Bulan" },
  { months: 6, label: "6 Bulan" },
  { months: 12, label: "12 Bulan / 1 Tahun" },
];

export function SalaryCalculator() {
  const [months, setMonths] = useState<SalaryMonths>(12);
  const result = calculator(months);

  return (
    <div className="rounded-2xl border border-[var(--sale-line)] bg-white p-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Jangka waktu gaji">
        {OPTIONS.map((option) => {
          const pressed = months === option.months;
          return (
            <button
              key={option.months}
              type="button"
              aria-pressed={pressed}
              onClick={() => setMonths(option.months)}
              className={
                pressed
                  ? "rounded-full bg-[var(--sale-navy)] px-4 py-2 text-sm text-white"
                  : "rounded-full border border-[var(--sale-line)] bg-white px-4 py-2 text-sm"
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <ul className="mt-5 divide-y divide-[var(--sale-line)] text-sm">
        {roles.map((role) => (
          <li key={role.name} className="flex items-center justify-between py-2">
            <span>{role.name}</span>
            <span>{formatIdr(role.salary)} / bulan</span>
          </li>
        ))}
      </ul>

      <dl className="mt-5 space-y-3">
        <div>
          <dt className="text-sm text-[var(--sale-muted)]">Total gaji tim {months} bulan</dt>
          <dd className="text-2xl font-semibold">{formatIdr(result.team)}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--sale-muted)]">Otomasi, sekali bayar</dt>
          <dd className="text-2xl font-semibold">{formatIdr(result.once)}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--sale-muted)]">Kamu hemat</dt>
          <dd className="text-2xl font-semibold text-[var(--sale-blue)]">{formatIdr(result.save)}</dd>
        </div>
      </dl>
    </div>
  );
}
