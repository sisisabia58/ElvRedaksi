import type { Sql } from "./client";

const BRAIN_DOCS: { slug: string; title: string; body: string }[] = [
  {
    slug: "00-baca-dulu",
    title: "Baca dulu",
    body: "Analis dan Copywriter membaca semua catatan ini setiap kali bekerja. Ubah gaya, ambang viral, dan larangan di sini. Jangan tempel artikel orang lain.",
  },
  {
    slug: "01-brand-voice",
    title: "Gaya bahasa",
    body: 'Bahasa Indonesia santai, kalimat pendek, sapaan "kamu". Jangan mengaku telah membaca lebih dari cuplikan. Jangan menjual.',
  },
  {
    slug: "02-kriteria-viral",
    title: "Kriteria viral",
    body: "Skor lima aspek, masing-masing bilangan bulat 0–20: Relevansi (marketing, iklan, media sosial, AI untuk marketing tinggi; gosip, kripto, dan politik rendah), Emosi, Kebaruan (fitur atau rilis, bukan opini daur ulang), Timing (turun setelah 48 jam), Shareability. Lolos pada 70. Sertakan tag singkat.",
  },
  {
    slug: "03-aturan-caption",
    title: "Aturan caption",
    body: "Caption 2–4 kalimat plus 3–8 hashtag tanpa tanda pagar di data. Sebut nama sumber.",
  },
  {
    slug: "04-topik-sensitif",
    title: "Topik sensitif",
    body: "Tandai sensitif, jangan otomatis buang, untuk kecelakaan, kematian, kesehatan mental, konflik bersenjata, dan tuduhan kriminal yang belum diputuskan. blocked=true hanya jika catatan ini menyebut topiknya sebagai larangan keras.",
  },
  {
    slug: "05-contoh-post",
    title: "Contoh post",
    body: "Hook satu napas, satu fakta per slide, slide terakhir ajakan atau pendapat.",
  },
  {
    slug: "06-aturan-carousel",
    title: "Aturan carousel",
    body: "Carousel penuh: 1 sampul + 2 sampai 5 slide poin. Teaser: sampul + 1 slide CTA ke link bio. Setiap slide memuat nama sumber. Jangan minta foto dari situs berita.",
  },
];

export async function seedDefaults(sql: Sql): Promise<void> {
  const existing = await sql.rows<{ id: number }>("select id from brand where id = 1");
  if (existing.length > 0) {
    return;
  }

  await sql.rows(
    `insert into brand (name, handle, initial, accent, kicker, pass_threshold, default_format, default_template)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (id) do nothing`,
    ["Redaksi", "redaksi", "R", "#d7ff3a", "Catatan redaksi", 70, "teaser_bio", "serif"],
  );

  for (const doc of BRAIN_DOCS) {
    await sql.rows(
      `insert into brain_docs (slug, title, body)
       values ($1, $2, $3)
       on conflict (slug) do nothing`,
      [doc.slug, doc.title, doc.body],
    );
  }
}
