/**
 * Some Android gallery providers report application/octet-stream (or an
 * unrecognised alias) for a playable clip. Only replace an unknown MIME when
 * the file's own header identifies a supported container. Never guess from the
 * path or call arbitrary bytes an MP4.
 */
const supported = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
  'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v',
]);

export function uploadContentType(declared: string, file: ArrayBuffer): string {
  const type = declared.split(';', 1)[0].trim().toLowerCase();
  if (supported.has(type)) return type;
  const b = new Uint8Array(file, 0, Math.min(file.byteLength, 512));
  const text = (start: number, length: number) => String.fromCharCode(...b.slice(start, start + length));
  if (b.length >= 12 && text(4, 4) === 'ftyp') {
    const brands: string[] = [text(8, 4)];
    // ISO BMFF has a minor version at offset 12, followed by compatible brands.
    const boxSize = ((b[0] * 0x1000000) + (b[1] << 16) + (b[2] << 8) + b[3]) >>> 0;
    if (boxSize >= 16 && boxSize <= file.byteLength) {
      for (let i = 16; i + 4 <= Math.min(boxSize, b.length); i += 4) brands.push(text(i, 4));
      if (brands.some((x) => /^(heic|heix|hevc|hevx|mif1|msf1|avif|avis)$/.test(x))) return type;
      if (brands.includes('qt  ')) return 'video/quicktime';
      if (brands.some((x) => /^(isom|iso[2-9]|mp4[12]|avc1|M4V |M4VH|M4VP|dash|3gp[4-9]|3g2[ab])$/.test(x))) return 'video/mp4';
    }
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
      && text(0, b.length).includes('webm')) return 'video/webm';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) return 'image/png';
  if (b.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return 'image/webp';
  return type || 'application/octet-stream';
}

/** Remove the database's internal error envelope before showing it to people. */
export function publicRpcError(message: string, fallbackStatus: number): { message: string; status: number } {
  const match = /^__CRUSHLY__(\d{3})__([a-z0-9_]*)__([\s\S]*)$/i.exec(message);
  if (!match) return { message, status: fallbackStatus };
  const status = Number(match[1]);
  return { message: match[3] || 'Something went wrong. Please try again.', status: status >= 400 && status <= 599 ? status : fallbackStatus };
}
