type SlideWithPhoto = {
  role: string;
  photoDataUrl?: string;
};

export function omitRejectedCoverPhoto<T extends SlideWithPhoto>(
  slides: T[],
  rejectedPhotoDataUrl: string | null,
): T[] {
  if (!rejectedPhotoDataUrl) {
    return slides;
  }
  return slides.map((slide) => {
    if (slide.role !== "cover" || slide.photoDataUrl !== rejectedPhotoDataUrl) {
      return slide;
    }
    const next = { ...slide };
    delete next.photoDataUrl;
    return next;
  });
}

export function coverUploadRejectionMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("Gambar") ||
    message.includes("Format gambar") ||
    message.includes("Hanya PNG") ||
    message.includes("Maksimal")
  ) {
    return message;
  }
  if (/body exceeded|body size|bodysizelimit|unexpected response|413/i.test(message)) {
    return "Gambar maksimal 2 MB";
  }
  return "Gagal mengunggah gambar";
}
