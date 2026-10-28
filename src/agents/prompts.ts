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

export function copySystem(brain: string): string {
  return `Kamu adalah copywriter redaksi. Baca brain berikut dan tulis carousel Instagram.

${brain}

Kembalikan hanya JSON slide dan caption sesuai aturan brain.`;
}
