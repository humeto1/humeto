import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const exec = promisify(execFile);
const bin = (name) =>
  process.env["HUMETO_" + name.toUpperCase() + "_BIN"] || name;
export async function run(name, args, timeout = 45000) {
  try {
    return (
      await exec(bin(name), args, {
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, OMP_THREAD_LIMIT: "1" },
      })
    ).stdout;
  } catch (e) {
    if (e.code === "ENOENT")
      throw Error(
        `Local ${name} is unavailable. Install the documented OCR tools and restart the worker.`,
      );
    if (e.killed || e.code === "ETIMEDOUT")
      throw Error(
        "Reading exceeded its time limit. Try a smaller or clearer document.",
      );
    throw Error(
      `The ${name} reader could not process this file. Try an unencrypted PDF or a clear PNG/JPEG.`,
    );
  }
}
export async function engineInfo() {
  const version = (await run("tesseract", ["--version"], 10000)).split("\n")[0];
  await run("pdfinfo", ["-v"], 10000);
  return version + " / Poppler / eng";
}
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, key) =>
    key[0] === "#"
      ? String.fromCodePoint(
          parseInt(
            key.slice(key[1]?.toLowerCase() === "x" ? 2 : 1),
            key[1]?.toLowerCase() === "x" ? 16 : 10,
          ),
        )
      : { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[
          key.toLowerCase()
        ] || "",
  );
export function parseBbox(xml) {
  const page = xml.match(/<page\b[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/),
    lines = [];
  if (!page) return { width: 1, height: 1, lines };
  for (const match of xml.matchAll(/<line\b[^>]*>([\s\S]*?)<\/line>/g)) {
    const words = [
      ...match[1].matchAll(
        /<word\b[^>]*xMin="([\d.-]+)"[^>]*yMin="([\d.-]+)"[^>]*xMax="([\d.-]+)"[^>]*yMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/g,
      ),
    ];
    if (!words.length) continue;
    const x = Math.min(...words.map((w) => +w[1])),
      y = Math.min(...words.map((w) => +w[2])),
      right = Math.max(...words.map((w) => +w[3])),
      bottom = Math.max(...words.map((w) => +w[4]));
    lines.push({
      text: words.map((w) => decode(w[5])).join(" "),
      box: [x, y, right - x, bottom - y],
      confidence: null,
    });
  }
  return { width: +page[1], height: +page[2], lines };
}
export function parseTsv(tsv) {
  const groups = new Map();
  let width = 1,
    height = 1;
  for (const raw of tsv.split(/\r?\n/).slice(1)) {
    const c = raw.split("\t");
    if (c.length < 12) continue;
    if (c[0] === "1") {
      width = +c[8] || 1;
      height = +c[9] || 1;
    }
    if (c[0] !== "5" || !c.slice(11).join("\t").trim()) continue;
    const key = c.slice(1, 5).join("-");
    if (!groups.has(key)) groups.set(key, []);
    groups
      .get(key)
      .push({
        x: +c[6],
        y: +c[7],
        w: +c[8],
        h: +c[9],
        confidence: +c[10],
        text: c.slice(11).join("\t"),
      });
  }
  return {
    width,
    height,
    lines: [...groups.values()].map((words) => {
      const x = Math.min(...words.map((w) => w.x)),
        y = Math.min(...words.map((w) => w.y));
      return {
        text: words.map((w) => w.text).join(" "),
        box: [
          x,
          y,
          Math.max(...words.map((w) => w.x + w.w)) - x,
          Math.max(...words.map((w) => w.y + w.h)) - y,
        ],
        confidence: words.reduce((s, w) => s + w.confidence, 0) / words.length,
      };
    }),
  };
}
export function dimensions(bytes, mime) {
  if (mime === "image/png" && bytes.length >= 24)
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 255) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 216 || marker === 217) {
        offset += 2;
        continue;
      }
      const size = bytes.readUInt16BE(offset + 2);
      if (size < 2) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      )
        return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
      offset += 2 + size;
    }
  }
  throw Error(
    "Image dimensions could not be read. Upload a valid PNG or JPEG.",
  );
}
export async function readDocument(
  input,
  mime,
  directory,
  onPage = async () => {},
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const pages = [],
    warnings = [];
  let count = 1;
  if (mime === "application/pdf") {
    const info = await run("pdfinfo", [input]);
    count = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
    if (/Encrypted:\s+yes/i.test(info))
      throw Error("Encrypted PDFs need an unlocked copy before reading.");
    if (!count || count > 20)
      throw Error(
        "This reader accepts up to 20 pages per document. Upload a smaller document.",
      );
  } else {
    const [w, h] = dimensions(await readFile(input), mime);
    if (w < 1 || h < 1 || w * h > 40000000)
      throw Error(
        "Image is too large for local OCR. Use an image under 40 megapixels.",
      );
  }
  for (let n = 1; n <= count; n++) {
    let page, preview;
    if (mime === "application/pdf") {
      const prefix = join(directory, "page-" + n);
      await run("pdftoppm", [
        "-f",
        String(n),
        "-l",
        String(n),
        "-singlefile",
        "-scale-to",
        "2400",
        "-png",
        input,
        prefix,
      ]);
      preview = prefix + ".png";
      const xml = await run("pdftotext", [
        "-f",
        String(n),
        "-l",
        String(n),
        "-bbox-layout",
        "-enc",
        "UTF-8",
        input,
        "-",
      ]);
      page = parseBbox(xml);
      page.method = "pdf-text";
      if (
        page.lines.reduce((s, l) => s + l.text.replace(/\s/g, "").length, 0) <
        30
      ) {
        page = parseTsv(
          await run("tesseract", [
            preview,
            "stdout",
            "-l",
            "eng",
            "--psm",
            "3",
            "tsv",
          ]),
        );
        page.method = "tesseract";
      }
    } else {
      page = parseTsv(
        await run("tesseract", [
          input,
          "stdout",
          "-l",
          "eng",
          "--psm",
          "3",
          "tsv",
        ]),
      );
      page.method = "tesseract";
      preview = join(
        directory,
        mime === "image/png" ? "page-1.png" : "page-1.jpg",
      );
      await writeFile(preview, await readFile(input), { mode: 0o600 });
    }
    if (
      page.lines.length > 10000 ||
      page.lines.reduce((s, l) => s + l.text.length, 0) > 250000
    )
      throw Error("Page text exceeds the local reading limit.");
    if (!page.lines.length)
      warnings.push(
        `Page ${n}: no readable text. A clearer image or manual entry may be needed.`,
      );
    pages.push({
      ...page,
      pageNumber: n,
      preview,
      text: page.lines.map((l) => l.text).join("\n"),
    });
    await onPage(n, count);
  }
  return { pages, warnings };
}
