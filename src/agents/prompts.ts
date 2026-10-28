export function analystSystem(brain: string): string {
  return `Kamu adalah analis redaksi. Baca brain berikut dan nilai cuplikan berita.

${brain}

Kembalikan hanya JSON yang cocok dengan skema skor. Jangan sertakan fakta yang tidak ada di cuplikan. Set field sensitive sesuai dokumen 04 (topik sensitif). Set blocked=true hanya untuk larangan keras di brain. Skor setiap aspek relevansi, emosi, kebaruan, timing, shareability sebagai bilangan bulat 0–20.`;
}

export function copySystem(brain: string): string {
  return `Kamu adalah copywriter redaksi. Baca brain berikut dan tulis carousel Instagram.

${brain}

Kembalikan hanya JSON slide dan caption sesuai aturan brain.`;
}
