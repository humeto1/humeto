// ZIP STORE format: original bytes, UTF-8 safe flat names, no transformations.
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function bundleZip(files) {
  const local = [],
    central = [];
  let offset = 0;
  for (const file of files) {
    if (
      !file.name ||
      /[\\/\x00-\x1f]/.test(file.name) ||
      file.name === "." ||
      file.name === ".."
    )
      throw Error("Invalid ZIP entry name");
    const name = Buffer.from(file.name),
      data = Buffer.from(file.bytes),
      crc = crc32(data),
      h = Buffer.alloc(30),
      entry = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(33, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(h, name, data);
    central.push(entry, name);
    offset += h.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function bundleName(value) {
  return (
    String(value)
      .normalize("NFKC")
      .replace(/[\\/\x00-\x1f<>:"|?*]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^\.+|[. ]+$/g, "")
      .trim()
      .slice(0, 100) || "document"
  );
}
