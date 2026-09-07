import { buildDocx, buildZip, paragraphs } from './__fixtures__/build';
import { documentXmlToText, extractDocxText } from './docx';
import { MAX_ENTRY_BYTES, readZipEntry, ZipError } from './zip';

const encoder = new TextEncoder();

describe('documentXmlToText', () => {
  it('turns paragraphs into lines', () => {
    const text = documentXmlToText(paragraphs(['Ada Lovelace', 'ada@example.com']));
    expect(text).toBe('Ada Lovelace\nada@example.com');
  });

  it('decodes named and numeric entities', () => {
    const xml = paragraphs(['R&amp;D &lt;lead&gt;', '&#65;&#x42;']);
    expect(documentXmlToText(xml)).toBe('R&D <lead>\nAB');
  });

  it('keeps a table row on one line', () => {
    const xml =
      '<w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Acme</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>2019 - present</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>';
    expect(documentXmlToText(xml)).toBe('Acme 2019 - present');
  });

  it('drops field codes and tracked deletions', () => {
    const xml =
      '<w:p><w:r><w:instrText> HYPERLINK "https://example.com" </w:instrText></w:r>' +
      '<w:r><w:delText>removed</w:delText></w:r>' +
      '<w:r><w:t>kept</w:t></w:r></w:p>';
    expect(documentXmlToText(xml)).toBe('kept');
  });

  it('is deterministic', () => {
    const xml = paragraphs(['Skills', 'TypeScript, Angular']);
    expect(documentXmlToText(xml)).toBe(documentXmlToText(xml));
  });
});

describe('extractDocxText', () => {
  it('reads word/document.xml out of a real package', async () => {
    const docx = await buildDocx(
      paragraphs(['Ada Lovelace', 'Technical Skills', 'TypeScript, Docker']),
    );
    await expect(extractDocxText(docx)).resolves.toBe(
      'Ada Lovelace\nTechnical Skills\nTypeScript, Docker',
    );
  });

  it('reads a stored (uncompressed) entry', async () => {
    const zip = await buildZip([
      {
        name: 'word/document.xml',
        data: encoder.encode(paragraphs(['Stored'])),
        method: 0,
      },
    ]);
    await expect(extractDocxText(zip)).resolves.toBe('Stored');
  });

  it('rejects a package with no document part', async () => {
    const zip = await buildZip([
      { name: 'word/vbaProject.bin', data: encoder.encode('macro') },
    ]);
    await expect(extractDocxText(zip)).rejects.toThrow(ZipError);
  });

  it('rejects a file that is not a zip at all', async () => {
    await expect(extractDocxText(encoder.encode('plain text'))).rejects.toThrow(ZipError);
  });
});

describe('zip-bomb defences (SECURITY.md T7)', () => {
  it('rejects an entry whose declared size is over the limit', async () => {
    const zip = await buildZip([
      {
        name: 'word/document.xml',
        data: encoder.encode('small'),
        declaredSize: MAX_ENTRY_BYTES + 1,
      },
    ]);
    await expect(extractDocxText(zip)).rejects.toThrow(/limit/);
  });

  it('aborts inflation when the real output exceeds the cap, however the header lies', async () => {
    // 200 kB of zeroes deflates to almost nothing and declares itself as 10 bytes.
    const zip = await buildZip([
      {
        name: 'word/document.xml',
        data: new Uint8Array(200_000),
        declaredSize: 10,
      },
    ]);
    await expect(readZipEntry(zip, 'word/document.xml', 1024)).rejects.toThrow(
      /inflates past/,
    );
  });

  it('caps a stored entry by its real length too', async () => {
    const zip = await buildZip([
      {
        name: 'word/document.xml',
        data: new Uint8Array(4096),
        method: 0,
        declaredSize: 10,
      },
    ]);
    await expect(readZipEntry(zip, 'word/document.xml', 1024)).rejects.toThrow(/limit/);
  });

  it('rejects an unsupported compression method rather than guessing', async () => {
    const zip = await buildZip([
      { name: 'word/document.xml', data: encoder.encode('x'), method: 12 },
    ]);
    await expect(readZipEntry(zip, 'word/document.xml')).rejects.toThrow(
      /compression method 12/,
    );
  });

  it('rejects an archive claiming more entries than the cap', async () => {
    const zip = await buildZip([
      { name: 'word/document.xml', data: encoder.encode('x') },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // Rewrite the EOCD entry counts; the record is the last 22 bytes.
    view.setUint16(zip.byteLength - 22 + 10, 4096, true);
    await expect(readZipEntry(zip, 'word/document.xml')).rejects.toThrow(/limit 512/);
  });

  it('returns undefined for an entry the archive does not contain', async () => {
    const zip = await buildZip([{ name: 'other.xml', data: encoder.encode('x') }]);
    await expect(readZipEntry(zip, 'word/document.xml')).resolves.toBeUndefined();
  });
});
