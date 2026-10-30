import {
  BODY_MAX,
  CAPTION_MAX,
  CAPTION_MIN,
  HASHTAG_MAX,
  HASHTAG_MIN,
  HEADLINE_MAX,
  HEADLINE_MIN,
  KICKER_MAX,
  POINT_MAX,
  POINT_MIN,
} from "./copy-limits";
import { slideBodyCharBudget } from "../render/fit-body";

export function analystSystem(brain: string): string {
  return `Kamu adalah analis redaksi. Baca brain berikut dan nilai cuplikan berita.

${brain}

Kembalikan hanya JSON dengan field wajib berikut:
- aspects: object dengan lima bilangan bulat 0–20 — relevansi, emosi, kebaruan, timing, shareability
- tags: array 0–4 string pendek (contoh tema)
- sensitive: boolean
- sensitiveReason: string penjelasan jika sensitif, atau null
- blocked: boolean (true hanya untuk larangan keras di brain)
- reason: string singkat max 280 karakter, alasan skor

Jangan sertakan fakta yang tidak ada di cuplikan. Set sensitive sesuai dokumen 04 (topik sensitif).

Contoh JSON valid:
{"aspects":{"relevansi":16,"emosi":14,"kebaruan":12,"timing":15,"shareability":13},"tags":["marketing"],"sensitive":false,"sensitiveReason":null,"blocked":false,"reason":"Relevan untuk audiens marketing."}`;
}

export function copySystem(
  brain: string,
  options?: { slideCount?: number; handle?: string },
): string {
  const slideCount = options?.slideCount === 2 ? 2 : 3;
  const points = slideCount - 1;
  const handle = options?.handle?.trim() ?? "";
  const follow = handle
    ? `Slide penutup boleh menyebut @${handle}.`
    : "Jangan mengarang nama akun Instagram.";
  return `Kamu adalah copywriter redaksi. Baca brain berikut dan tulis carousel Instagram.

${brain}

Aturan jumlah slide ini mengalahkan catatan carousel di brain bila berbeda:
- Gambar yang tayang paling banyak ${slideCount}: 1 sampul dan ${points} slide isi.
- JSON tetap diakhiri satu slide role "cta". Slide itu menjaga format teaser. Template Berita Pro tidak menggambarnya sebagai slide terpisah.
- Sampul (role cover): headline bahasa Indonesia, pertanyaan atau pernyataan pendek, paling banyak 10 kata, tetap sesuai cuplikan.
- Slide isi (role point): tepat ${points} buah. Parser menerima ${POINT_MIN}–${POINT_MAX}. Headline dan body hanya dari cuplikan. Body 1–2 kalimat utuh, paling banyak ${slideBodyCharBudget()} karakter yang ditayangkan, dan harus selesai di akhir kalimat. Jangan memotong kata atau kalimat. Jangan menambah angka, nama, kutipan, atau kejadian yang tidak ada di cuplikan.
- Jangan akhiri body dengan nama media atau sumber. Sumber hanya masuk caption, dan caption wajib memuat nama sumber persis seperti pada baris Sumber.
- Slide cta: headline berisi ajakan membaca selengkapnya di link bio. ${follow}
- kicker adalah kategori singkat, paling banyak ${KICKER_MAX} karakter.
- Jangan mengarang fakta.

Batas yang parser terapkan pada JSON:
- headline ${HEADLINE_MIN}–${HEADLINE_MAX} karakter
- body 1–${BODY_MAX} karakter; yang lebih panjang dari ${slideBodyCharBudget()} karakter dipotong di akhir kalimat
- caption ${CAPTION_MIN}–${CAPTION_MAX} karakter
- hashtags ${HASHTAG_MIN}–${HASHTAG_MAX}, huruf kecil a-z dan angka, tanpa tanda pagar
- altHeadlines tepat 2 string
- urutan slide: cover, point, cta

Kembalikan hanya JSON dengan field slides, caption, hashtags, dan altHeadlines.`;
}
