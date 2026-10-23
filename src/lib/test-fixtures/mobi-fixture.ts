/** Original test prose encoded as a real Palm Database/MOBI publication. */
export function mobiFixture(options: {
  compression?: number;
  encryption?: number;
  noExth?: boolean;
  declaredLength?: number;
  html?: string;
  version?: number;
  hybrid?: boolean;
} = {}): Uint8Array {
  const encoder = new TextEncoder();
  let html = options.html ?? '<html><head><guide><reference type="toc" filepos="TOCPOS0000"/></guide></head><body><h1>Opening</h1><p id="origin">你好 world. <a filepos="NOTEPOS000">Note</a></p><img recindex="1" alt="Original figure"/><a href="https://example.com/">Source</a><mbp:pagebreak/><h1>Contents</h1><p><a filepos="OPENPOS000">Opening</a></p><p><a filepos="NOTEPOS000">Notes</a></p><mbp:pagebreak/><h1>Notes</h1><p>Original endnote. <a filepos="OPENPOS000">Back</a></p></body></html>';
  const bytePosition = (needle: string) => String(encoder.encode(html.slice(0, html.indexOf(needle))).length).padStart(10, "0");
  const replacements = new Map([
    ["TOCPOS0000", bytePosition("<h1>Contents")],
    ["NOTEPOS000", bytePosition("<h1>Notes")],
    ["OPENPOS000", bytePosition("<h1>Opening")],
  ]);
  for (const [from, to] of replacements) html = html.replaceAll(from, to);
  const text = encoder.encode(html);
  let textRecord = text;
  if (options.compression === 2) {
    const encoded: number[] = [];
    for (let i = 0; i < text.length; i += 8) {
      const chunk = text.subarray(i, i + 8);
      encoded.push(chunk.length, ...chunk);
    }
    textRecord = Uint8Array.from(encoded);
  }
  const exthRecords: Uint8Array[] = [];
  for (const [type, value] of [[100, "林舟"], [101, "Fixture Press"], [103, "<b>Original fixture</b>"], [503, "MOBI 测试书"], [524, "zh-CN"]] as const) {
    const bytes = encoder.encode(value);
    const record = new Uint8Array(8 + bytes.length);
    new DataView(record.buffer).setUint32(0, type);
    new DataView(record.buffer).setUint32(4, record.length);
    record.set(bytes, 8);
    exthRecords.push(record);
  }
  if (options.hybrid) {
    const record = new Uint8Array(12);
    const view = new DataView(record.buffer);
    view.setUint32(0, 121);
    view.setUint32(4, 12);
    view.setUint32(8, 4);
    exthRecords.push(record);
  }
  const exthLength = options.noExth ? 0 : 12 + exthRecords.reduce((sum, item) => sum + item.length, 0);
  const title = encoder.encode("Header title");
  const header = new Uint8Array(16 + 232 + exthLength + title.length);
  const view = new DataView(header.buffer);
  view.setUint16(0, options.compression ?? 1);
  view.setUint32(4, options.declaredLength ?? text.length);
  view.setUint16(8, 1);
  view.setUint16(10, 4096);
  view.setUint16(12, options.encryption ?? 0);
  header.set(encoder.encode("MOBI"), 16);
  view.setUint32(20, 232);
  view.setUint32(24, 2);
  view.setUint32(28, 65001);
  view.setUint32(32, 12345);
  view.setUint32(36, options.version ?? 6);
  view.setUint32(84, 16 + 232 + exthLength);
  view.setUint32(88, title.length);
  header[95] = 4;
  view.setUint32(108, 2);
  view.setUint32(128, options.noExth ? 0 : 64);
  view.setUint32(244, 0xffffffff);
  if (!options.noExth) {
    header.set(encoder.encode("EXTH"), 248);
    view.setUint32(252, exthLength);
    view.setUint32(256, exthRecords.length);
    let offset = 260;
    for (const record of exthRecords) {
      header.set(record, offset);
      offset += record.length;
    }
  }
  header.set(title, 16 + 232 + exthLength);
  // Valid 1 x 1 transparent PNG, original fixture resource.
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6XAoAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
  const records = [header, textRecord, png];
  if (options.hybrid) {
    const kf8Header = header.slice();
    new DataView(kf8Header.buffer).setUint32(36, 8);
    records.push(encoder.encode("BOUNDARY"), kf8Header, encoder.encode("Second KF8 rendition must not leak into MOBI7 text."));
  }
  let offset = 78 + records.length * 8 + 2;
  const pdb = new Uint8Array(offset + records.reduce((sum, record) => sum + record.length, 0));
  const pdbView = new DataView(pdb.buffer);
  pdb.set(encoder.encode("Original fixture"));
  pdb.set(encoder.encode("BOOKMOBI"), 60);
  pdbView.setUint16(76, records.length);
  for (let i = 0; i < records.length; i++) {
    pdbView.setUint32(78 + i * 8, offset);
    pdb.set(records[i], offset);
    offset += records[i].length;
  }
  return pdb;
}
