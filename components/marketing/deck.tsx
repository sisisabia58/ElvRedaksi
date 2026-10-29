"use client";

import { useEffect, useRef, useState } from "react";

const SLIDES: { kicker: string; title: string; body: string }[] = [
  {
    kicker: "Janji",
    title: "Agen mencari, menulis, dan merancang",
    body: "Scout mengambil topik, Analis menilai, Copywriter menulis, dan Designer merender. Kamu menyetujui sebelum apa pun dijadwalkan atau terbit.",
  },
  {
    kicker: "Empat hambatan",
    title: "Kerja yang biasanya menumpuk di meja",
    body: "Topik dicari manual, naskah ditulis dari nol, ukuran slide diukur ulang, dan posting jalan tanpa catatan persetujuan. Redaksi memindahkan empat pekerjaan itu ke antrean yang bisa dicek.",
  },
  {
    kicker: "Estafet",
    title: "Empat agen, satu meja",
    body: "Scout selesai, Analis mulai. Topik yang lolos ambang dilanjutkan Copywriter. Naskah yang siap dirender Designer. Manusia berdiri di ujung estafet.",
  },
  {
    kicker: "Sumber",
    title: "RSS yang kamu pegang sendiri",
    body: "Setiap sumber punya nama, URL, dan bahasa Indonesia atau Inggris. Setiap topik menyimpan tautan artikel. Setiap slide menuliskan nama sumber di bagian bawah.",
  },
  {
    kicker: "Brain",
    title: "Catatan yang dibaca agen",
    body: "Gaya bahasa, ambang viral, caption, topik sensitif, dan aturan carousel tinggal di Brain. Analis dan Copywriter menerima isi catatan itu pada setiap giliran.",
  },
  {
    kicker: "Radar",
    title: "Skor sebelum jadi naskah",
    body: "Lima aspek, masing-masing 0 sampai 20. Lolos pada 70. Topik sensitif tetap bisa lolos dan ditandai supaya tim mengecek risiko. Yang lolos bisa diminta jadi konten.",
  },
  {
    kicker: "Overview",
    title: "Ruang redaksi tetap semi-otomatis",
    body: "Mode selalu Semi-otomatis. Jam kerja bawaan 07:00–22:00 WIB. Di luar jam itu giliran otomatis menunggu. Tombol manual tetap bisa dijalankan.",
  },
  {
    kicker: "Review",
    title: "Tidak ada yang terbit tanpa tim",
    body: "Cek fakta, ubah teks kalau perlu, lalu setujui dan jadwalkan. Kalau teks berubah sesudah render terakhir, setujui dan jadwal menunggu render ulang.",
  },
  {
    kicker: "Format",
    title: "Carousel penuh atau teaser dua slide",
    body: "Carousel penuh berisi 3 sampai 6 slide. Teaser berisi sampul dan ajakan ke tautan bio. Keduanya 1080×1350. Rasio yang dicampur tidak dipakai.",
  },
  {
    kicker: "Terbit",
    title: "API resmi, akun Business atau Creator",
    body: "Posting lewat API Instagram resmi dari Meta. TikTok dan Reels tidak ada. Worker hanya menerbitkan setelah manusia lebih dulu menjadwalkan.",
  },
  {
    kicker: "Analitik",
    title: "Angka hanya dari API",
    body: "Rentang 7, 28, dan 90 hari: followers, views, reach, dan interaksi. Kalau token kosong, tabel tetap kosong. Angka tidak dikarang.",
  },
  {
    kicker: "14 hari",
    title: "Serah terima aplikasi dan source code",
    body: "Pengerjaan 14 hari, termasuk uji coba. Kamu menerima aplikasi, source code, dan setup di VPS kamu. Bukan langganan ke pembuat.",
  },
];

export function Deck() {
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const slide = SLIDES[index]!;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        setIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "ArrowRight") {
        setIndex((current) => Math.min(SLIDES.length - 1, current + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openFullscreen() {
    const element = rootRef.current;
    if (!element) {
      return;
    }
    void element.requestFullscreen();
  }

  return (
    <section
      ref={rootRef}
      className="flex min-h-[520px] flex-col bg-[var(--sale-navy)] text-white [&:fullscreen]:h-screen [&:fullscreen]:min-h-screen"
    >
      <div className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-10">
        <p className="text-xs tracking-[0.16em] text-white/60 uppercase">{slide.kicker}</p>
        <h2 className="mt-3 font-[family-name:var(--font-anton)] text-3xl uppercase leading-tight tracking-wide sm:text-4xl">
          {slide.title}
        </h2>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80">{slide.body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/15 px-6 py-4 sm:px-10">
        <button
          type="button"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={index === 0}
          className="rounded-full border border-white/30 px-4 py-2 text-sm disabled:opacity-40"
        >
          Sebelumnya
        </button>
        <button
          type="button"
          onClick={() => setIndex((current) => Math.min(SLIDES.length - 1, current + 1))}
          disabled={index === SLIDES.length - 1}
          className="rounded-full border border-white/30 px-4 py-2 text-sm disabled:opacity-40"
        >
          Berikutnya
        </button>
        <button
          type="button"
          onClick={openFullscreen}
          className="rounded-full bg-white px-4 py-2 text-sm text-[var(--sale-navy)]"
        >
          Layar penuh
        </button>
        <p className="ml-auto text-sm text-white/70">
          {index + 1} / {SLIDES.length}
        </p>
      </div>
    </section>
  );
}
