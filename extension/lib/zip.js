// Minimal ZIP writer: "stored" entries only (no compression, images are already
// compressed), CRC-32, UTF-8 names. No ZIP64, so the archive must stay under
// 4 GiB and 65,535 entries.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * entries: [{ name: string, data: Uint8Array }]. Returns a Blob (application/zip).
 */
export function makeZip(entries, when = new Date()) {
  if (entries.length > 0xffff) throw new Error('Too many files for one ZIP');
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const parts = [];
  const central = [];
  let offset = 0;
  let centralSize = 0;
  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const size = data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true);         // version needed (2.0)
    local.setUint16(6, 0x0800, true);     // flags: UTF-8 names
    local.setUint16(8, 0, true);          // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);      // compressed size
    local.setUint32(22, size, true);      // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);         // extra length
    parts.push(local, nameBytes, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);   // central directory signature
    cen.setUint16(4, 20, true);           // version made by
    cen.setUint16(6, 20, true);           // version needed
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, size, true);
    cen.setUint32(24, size, true);
    cen.setUint16(28, nameBytes.length, true);
    // 30 extra len, 32 comment len, 34 disk number, 36 internal attrs, 38 external attrs: all 0
    cen.setUint32(42, offset, true);      // offset of local header
    central.push(cen, nameBytes);

    offset += 30 + nameBytes.length + size;
    centralSize += 46 + nameBytes.length;
    if (offset > 0xffffffff) throw new Error('ZIP would exceed 4 GB');
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);     // end of central directory signature
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true);// total entries
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);        // central directory offset
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
