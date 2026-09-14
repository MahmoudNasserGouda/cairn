import { buildDocx, buildZip, paragraphs } from './__fixtures__/build';
import { documentXmlToText, extractDocxText } from './docx';
import { MAX_ENTRY_BYTES, ZipError } from '@cairn/zip';

const encoder = new TextEncoder();

describe('documentXmlToText', () => {
  it('turns paragraphs into lines', () => {
    const text = documentXmlToText(paragraphs(['Ada Lovelace', 'ada@example.com']));
    expect(text).toBe('Ada Lovelace\nada@example.com');
  });

  it('decodes named and numeric entities', () => {
    const xml = paragraphs(['R&amp;D', '&#65;&#x42;']);
    expect(documentXmlToText(xml)).toBe('R&D\nAB');
  });

  it('strips a tag that only exists via entity decoding, not just literal tags', () => {
    // Word stores a CV that literally mentions "<script>" as an entity-encoded
    // string, not a literal '<'. Decoding must happen before the tag strip, or
    // the decoded text re-forms a tag-shaped string in the output.
    const xml = paragraphs(['before &lt;script&gt;alert(1)&lt;/script&gt; after']);
    const text = documentXmlToText(xml);
    expect(text).not.toContain('<script>');
    expect(text).toBe('before alert(1) after');
  });

  it('does not let a single strip pass reform a tag from its own leftovers', () => {
    // A single pass of /<[^>]*>/g on this input removes "<scr<script>" (up to
    // the first '>'), leaving "ipt>alert(1)</script>" — which itself still
    // contains "</script>". A non-looping strip would let that survive.
    const xml = paragraphs(['<scr<script>ipt>alert(1)</script>']);
    expect(documentXmlToText(xml)).not.toMatch(/<\/?script>/i);
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

/**
 * The container's own defences live in `libs/zip`, where they are tested directly.
 * This asserts the one thing that is DOCX's to assert: the cap is actually applied on
 * the path a Word file takes, rather than being a capability nothing wires up.
 */
describe('zip-bomb defences reach the DOCX path (SECURITY.md T7)', () => {
  it('rejects a document part whose declared size is over the limit', async () => {
    const zip = await buildZip([
      {
        name: 'word/document.xml',
        data: encoder.encode('small'),
        declaredSize: MAX_ENTRY_BYTES + 1,
      },
    ]);
    await expect(extractDocxText(zip)).rejects.toThrow(/limit/);
  });
});
