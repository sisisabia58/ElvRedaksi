import type { Metadata } from "next";
import { SalaryCalculator } from "@/components/marketing/calculator";
import { faq, formatIdr, packages } from "@/src/marketing/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Redaksi",
  description:
    "Agen mencari, menulis, dan merancang carousel Instagram. Manusia menyetujui sebelum apa pun terbit.",
};

const CHIPS = ["24 jam", "14 hari", "tanpa tim", "milik kamu"] as const;

const PROOF = [
  { src: "/marketing/contoh-carousel-1.png", alt: "Contoh carousel, slide 1 dari 3" },
  { src: "/marketing/contoh-carousel-2.png", alt: "Contoh carousel, slide 2 dari 3" },
  { src: "/marketing/contoh-carousel-3.png", alt: "Contoh carousel, slide 3 dari 3" },
] as const;

const PAIRS = [
  {
    problem: "Topik habis sebelum jam posting tiba",
    answer:
      "Scout membaca RSS yang kamu daftarkan dan menaruh judul baru beserta tautan artikel aslinya.",
  },
  {
    problem: "Naskah carousel ditulis dari nol setiap kali",
    answer: "Copywriter menyusun slide, caption, dan hashtag dari cuplikan serta catatan di Brain.",
  },
  {
    problem: "Ukuran gambar berganti-ganti",
    answer:
      "Designer merender slide 1080×1350 di dalam aplikasi. Foto dari situs berita tidak diunduh.",
  },
  {
    problem: "Posting jalan tanpa ada yang meninjau",
    answer:
      "Tidak ada mode otomatis penuh. Manusia menyetujui sebelum sebuah draf dijadwalkan atau terbit.",
  },
] as const;

const AGENTS = [
  {
    name: "Scout",
    color: "var(--scout)",
    body: "Mengambil judul dari sumber yang kamu pegang. Setiap topik menyimpan URL dan nama media.",
  },
  {
    name: "Analis",
    color: "var(--analis)",
    body: "Menilai lima aspek. Lolos pada 70. Topik sensitif ditandai supaya tim yang mengecek.",
  },
  {
    name: "Copywriter",
    color: "var(--copywriter)",
    body: "Menulis slide dan caption dengan gaya yang tersimpan di Brain, lalu menyebut nama sumber.",
  },
  {
    name: "Designer",
    color: "var(--designer)",
    body: "Merender template menjadi PNG 1080×1350. Visual dibuat di aplikasi atau diunggah operator.",
  },
] as const;

const AUDIENCES = [
  "Media & portal berita",
  "Brand & UMKM",
  "Agency",
  "Instansi & kampus",
  "Homeless media",
  "Personal branding",
] as const;

const VENDOR_ROWS = [
  { perDay: "5", month: "Rp30rb", year: "Rp365rb" },
  { perDay: "10", month: "Rp60rb", year: "Rp730rb" },
  { perDay: "15", month: "Rp90rb", year: "Rp1,1jt" },
  { perDay: "30", month: "Rp180rb", year: "Rp2,2jt" },
] as const;

function whatsAppHref(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}`;
}

export default function MarketingPage() {
  const contactWa = process.env.CONTACT_WA?.trim() ?? "";
  // Bracket access so Next does not inline an empty build-time value.
  const batchNote = (process.env["NEXT_PUBLIC_BATCH_NOTE"] ?? "").trim();

  return (
    <>
      {batchNote ? (
        <p className="mx-5 mt-6 rounded-lg border border-[var(--sale-line)] bg-white px-4 py-3 text-sm">
          {batchNote}
        </p>
      ) : null}

      <header className="relative left-1/2 mt-6 w-screen -translate-x-1/2 bg-[var(--sale-navy)] text-white">
        <div className="mx-auto max-w-[760px] px-5 py-16">
          <p className="text-xs tracking-[0.2em] text-white/60">REDAKSI</p>
          <h1 className="mt-3 font-[family-name:var(--font-anton)] text-4xl leading-tight tracking-wide uppercase sm:text-5xl">
            Agen mencari, menulis, dan merancang. Kamu yang menyetujui.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80">
            Empat agen menyiapkan carousel Instagram dari sumber yang kamu pilih. Tidak ada yang
            terbit sebelum ada persetujuan manusia.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {CHIPS.map((chip) => (
              <li key={chip} className="rounded-full border border-white/25 px-3 py-1 text-sm">
                {chip}
              </li>
            ))}
          </ul>
        </div>
      </header>

      <main>
        <section className="px-5 py-12">
          <h2 className="text-2xl font-semibold">Teaser dua slide, dengan kredit sumber</h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--sale-muted)]">
            Format pendek berisi sampul dan ajakan ke tautan bio. Visual dibuat di dalam aplikasi
            atau diunggah operator. Foto dari situs berita tidak diunduh dan tidak dipasang dari
            tautan orang lain. Setiap slide mencantumkan nama sumber. Klik di halaman bio dihitung,
            lalu pembaca diarahkan ke artikel aslinya.
          </p>
        </section>

        <section className="px-5 pb-12">
          <h2 className="text-2xl font-semibold">Contoh carousel</h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--sale-muted)]">
            Tiga slide statis untuk artikel contoh berjudul Contoh carousel. Gambar ini dirender di
            aplikasi, bukan tangkapan akun orang lain.
          </p>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {PROOF.map((slide) => (
              <img
                key={slide.src}
                src={slide.src}
                alt={slide.alt}
                width={1080}
                height={1350}
                className="aspect-[1080/1350] w-full rounded-lg border border-[var(--sale-line)] object-cover"
              />
            ))}
          </div>
        </section>

        <section className="space-y-4 px-5 pb-12">
          <h2 className="text-2xl font-semibold">Yang biasanya macet, dan yang dikerjakan agen</h2>
          {PAIRS.map((pair) => (
            <article key={pair.problem} className="rounded-2xl border border-[var(--sale-line)] bg-white p-4">
              <h3 className="font-semibold">{pair.problem}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--sale-muted)]">{pair.answer}</p>
            </article>
          ))}
        </section>

        <section className="relative left-1/2 w-[min(1120px,100vw)] -translate-x-1/2 px-5 pb-12">
          <h2 className="mx-auto max-w-[760px] text-2xl font-semibold">Empat agen di meja yang sama</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {AGENTS.map((agent) => (
              <article
                key={agent.name}
                className="rounded-2xl border border-[var(--sale-line)] bg-white p-4"
                style={{ borderTopWidth: 4, borderTopColor: agent.color }}
              >
                <h3 className="text-lg font-semibold">{agent.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--sale-muted)]">{agent.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="px-5 pb-12">
          <h2 className="text-2xl font-semibold">Untuk siapa</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {AUDIENCES.map((audience) => (
              <li
                key={audience}
                className="rounded-full border border-[var(--sale-line)] bg-white px-3 py-1 text-sm"
              >
                {audience}
              </li>
            ))}
          </ul>
        </section>

        <section className="px-5 pb-12">
          <h2 className="text-2xl font-semibold">Cara kerja</h2>
          <iframe
            src="/presentasi"
            title="Cara kerja Redaksi"
            allowFullScreen
            className="mt-4 h-[520px] w-full rounded-xl border border-[var(--sale-line)] bg-white"
          />
          <a href="/presentasi" className="mt-3 inline-block text-sm font-medium text-[var(--sale-blue)]">
            Buka layar penuh
          </a>
        </section>

        <section className="px-5 pb-12">
          <h2 className="text-2xl font-semibold">Kalau dikerjakan tim</h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--sale-muted)]">
            Lima peran di bawah ini dijumlahkan per bulan, lalu dikali 3, 6, atau 12 bulan.
            Bandingannya adalah paket Development, sekali bayar.
          </p>
          <div className="mt-5">
            <SalaryCalculator />
          </div>
        </section>

        <section className="px-5 pb-12">
          <h2 className="text-2xl font-semibold">Dua cara mulai</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {packages.map((offer) => (
              <article key={offer.name} className="rounded-2xl border border-[var(--sale-line)] bg-white p-5">
                <h3 className="text-lg font-semibold">{offer.name}</h3>
                <p className="mt-2 text-3xl font-semibold">{formatIdr(offer.price)}</p>
                <p className="mt-1 text-sm text-[var(--sale-muted)]">{offer.cadence}</p>
                <ul className="mt-4 space-y-2 text-sm leading-relaxed">
                  {offer.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                {offer.note ? <p className="mt-4 text-sm font-medium">{offer.note}</p> : null}
              </article>
            ))}
          </div>
        </section>

        <section className="px-5 pb-12">
          <h2 className="text-2xl font-semibold">Biaya yang dibayar ke vendor</h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--sale-muted)]">
            Sekitar Rp200 per posting untuk token AI, dibayar ke penyedia model. VPS sekitar Rp1,5
            juta per tahun, dibayar ke penyedia server. Keduanya bukan iuran ke pembuat aplikasi.
            Sebulan dihitung 30 hari. Setahun dihitung 365 hari, lalu dibulatkan pada tabel.
          </p>
          <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--sale-line)] bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--sale-line)] text-[var(--sale-muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Posting per hari</th>
                  <th className="px-4 py-3 font-medium">Biaya AI sebulan</th>
                  <th className="px-4 py-3 font-medium">Biaya AI setahun</th>
                </tr>
              </thead>
              <tbody>
                {VENDOR_ROWS.map((row) => (
                  <tr key={row.perDay} className="border-b border-[var(--sale-line)] last:border-0">
                    <td className="px-4 py-3">{row.perDay}</td>
                    <td className="px-4 py-3">{row.month}</td>
                    <td className="px-4 py-3">{row.year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="px-5 pb-12">
          <h2 className="text-2xl font-semibold">Pertanyaan</h2>
          <div className="mt-4 divide-y divide-[var(--sale-line)] rounded-2xl border border-[var(--sale-line)] bg-white px-4">
            {faq.map((item) => (
              <details key={item.question} className="py-3">
                <summary className="cursor-pointer font-medium">{item.question}</summary>
                <p className="mt-2 text-sm leading-relaxed text-[var(--sale-muted)]">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="px-5 pb-16">
        <p className="text-lg leading-relaxed">
          Satu percakapan cukup untuk menyesuaikan niche, sumber, dan jadwal serah terima.
        </p>
        {contactWa ? (
          <a
            href={whatsAppHref(contactWa)}
            className="mt-4 inline-block rounded-full bg-[var(--sale-navy)] px-5 py-2 text-sm text-white"
          >
            WhatsApp
          </a>
        ) : null}
      </footer>
    </>
  );
}
