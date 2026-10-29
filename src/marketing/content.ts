export type SalaryMonths = 3 | 6 | 12;

export type SalaryRole = {
  name: string;
  salary: number;
};

export type Offer = {
  name: string;
  price: number;
  cadence: string;
  points: string[];
  note?: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

const DEVELOPMENT_PRICE = 5_000_000;

export const roles: SalaryRole[] = [
  { name: "Scout", salary: 3_500_000 },
  { name: "Analis", salary: 4_000_000 },
  { name: "Copywriter", salary: 4_000_000 },
  { name: "Designer", salary: 4_500_000 },
  { name: "Admin Sosmed", salary: 3_000_000 },
];

export const packages: Offer[] = [
  {
    name: "Development",
    price: DEVELOPMENT_PRICE,
    cadence: "sekali bayar, bukan tahunan",
    points: [
      "custom untuk niche kamu",
      "white-label",
      "setup ke VPS kamu",
      "serah terima aplikasi dan source code",
      "perawatan 6 bulan",
      "tanpa langganan ke pembuat",
    ],
  },
  {
    name: "Terima beres",
    price: 7_000_000,
    cadence: "total untuk tahun pertama",
    points: ["semua yang ada di Development", "VPS untuk 1 tahun", "saldo awal token AI"],
    note: "Selisih Rp2 juta = VPS setahun + saldo awal token AI.",
  },
];

export const faq: FaqItem[] = [
  {
    question: "Apakah biaya Development dibayar sekali?",
    answer:
      "Ya. Biaya paket Development dibayar sekali untuk aplikasi ini, bukan sebagai iuran yang diulang setiap tahun kepada pembuat.",
  },
  {
    question: "Apa isi selisih Rp2 juta pada paket Terima beres?",
    answer:
      "Selisih Rp2 juta itu menutup VPS untuk tahun pertama dan saldo awal token AI. Keduanya dibayar ke penyedia server dan penyedia model, bukan sebagai biaya tambahan ke pembuat.",
  },
  {
    question: "Apakah ada biaya bulanan yang disetor ke pembuat?",
    answer:
      "Tidak ada biaya bulanan ke pembuat. Setelah serah terima, kamu tidak berlangganan ke pihak yang membangun aplikasinya.",
  },
  {
    question: "Apakah saya harus bisa menulis kode?",
    answer:
      "Tidak. Kamu tidak perlu ngoding. Aplikasi disiapkan untuk niche kamu, lalu diserahkan bersama source code.",
  },
  {
    question: "Berapa lama pengerjaan, dan apakah ada masa coba?",
    answer:
      "Pengerjaan berjalan 14 hari dan sudah termasuk masa uji coba sebelum aplikasi dan source code diserahkan.",
  },
  {
    question: "Kapan pembayaran dilakukan?",
    answer: "Pembayaran dilakukan lunas di muka, sebelum pekerjaan dimulai.",
  },
  {
    question: "Bagaimana posting ke Instagram, dan akun seperti apa yang dipakai?",
    answer:
      "Posting memakai API resmi Meta. Akun Instagram harus bertipe Business atau Creator. Tidak ada bot di luar API itu.",
  },
  {
    question: "Apakah TikTok dan Reels ikut dalam paket?",
    answer:
      "TikTok dan Reels tidak termasuk. Yang disiapkan hanya carousel Instagram lewat API resmi Meta.",
  },
];

export function calculator(months: SalaryMonths): { team: number; once: number; save: number } {
  const monthly = roles.reduce((sum, role) => sum + role.salary, 0);
  const team = monthly * months;
  const once = DEVELOPMENT_PRICE;
  return { team, once, save: team - once };
}

export function formatIdr(amount: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
}
