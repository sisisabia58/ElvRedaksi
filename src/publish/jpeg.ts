import sharp from "sharp";

export async function pngToJpeg(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const jpeg = await sharp(bytes).toColorspace("srgb").jpeg({ quality: 90 }).toBuffer();
  return new Uint8Array(jpeg);
}
