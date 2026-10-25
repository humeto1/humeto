import sharp from "sharp";
export async function prepareProjectMedia(name: string, bytes: Buffer) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "wav") {
    if (
      bytes.length < 46 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE" ||
      bytes.toString("ascii", 12, 16) !== "fmt " ||
      bytes.readUInt32LE(16) !== 16 ||
      bytes.readUInt16LE(20) !== 1 ||
      bytes.readUInt16LE(22) !== 1 ||
      bytes.readUInt32LE(24) !== 16000 ||
      bytes.readUInt32LE(28) !== 32000 ||
      bytes.readUInt16LE(32) !== 2 ||
      bytes.readUInt16LE(34) !== 16 ||
      bytes.toString("ascii", 36, 40) !== "data" ||
      bytes.readUInt32LE(40) !== bytes.length - 44 ||
      bytes.readUInt32LE(4) !== bytes.length - 8 ||
      (bytes.length - 44) % 2 ||
      bytes.length - 44 > 60 * 32000
    )
      throw new Error(
        "Voice notes must be valid mono PCM audio, up to one minute.",
      );
    return {
      bytes,
      mime: "audio/wav",
      clean: true,
      duration: (bytes.length - 44) / 32000,
    };
  }
  if (["png", "jpg", "jpeg", "webp"].includes(ext || "")) {
    const image = sharp(bytes, { limitInputPixels: 16000000, animated: false });
    const meta = await image.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1
    )
      throw new Error("Choose a still PNG, JPEG or WebP image.");
    const output = await image
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFormat(
        ext === "jpg" || ext === "jpeg" ? "jpeg" : (ext as "png" | "webp"),
      )
      .toBuffer();
    if (output.length > 2 * 1024 * 1024)
      throw new Error("Image is too large. Choose an image up to 2 MB.");
    return {
      bytes: output,
      mime: ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`,
      clean: true,
      duration: null,
    };
  }
  return null;
}
