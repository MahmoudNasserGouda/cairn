import { describe, expect, it } from 'vitest';
import { buildZip } from './__fixtures__/build';
import { listZipEntries, MAX_ENTRY_BYTES, openZip, readZipEntry, ZipError } from './zip';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const text = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : decoder.decode(bytes);

describe('reading an entry', () => {
  it('inflates a deflated entry', async () => {
    const zip = await buildZip([{ name: 'a.txt', data: encoder.encode('hello') }]);
    expect(text(await readZipEntry(zip, 'a.txt'))).toBe('hello');
  });

  it('reads a stored (uncompressed) entry', async () => {
    const zip = await buildZip([
      { name: 'a.txt', data: encoder.encode('hello'), method: 0 },
    ]);
    expect(text(await readZipEntry(zip, 'a.txt'))).toBe('hello');
  });

  it('returns undefined for an entry the archive does not contain', async () => {
    const zip = await buildZip([{ name: 'other.txt', data: encoder.encode('x') }]);
    await expect(readZipEntry(zip, 'a.txt')).resolves.toBeUndefined();
  });

  it('rejects a file that is not a zip at all', async () => {
    await expect(readZipEntry(encoder.encode('not a zip'), 'a.txt')).rejects.toThrow(
      ZipError,
    );
  });
});

/**
 * Enumeration is what makes an allowlist enforceable
 * ([ADR-0029](../../../docs/adr/0029-linkedin-data-export-archive-import.md)): a
 * caller can decide what to open *before* a single byte is inflated, so "we never
 * read the connection graph" is a property of the code rather than a promise in a
 * README.
 */
describe('listing entries', () => {
  it('reports every entry without inflating any of them', async () => {
    const zip = await buildZip([
      { name: 'Positions.csv', data: encoder.encode('a,b\n1,2') },
      { name: 'Connections.csv', data: encoder.encode('secret') },
    ]);

    expect(listZipEntries(zip).map((e) => e.name)).toEqual([
      'Positions.csv',
      'Connections.csv',
    ]);
  });

  it('reports the declared size, which is the archive talking and not a measurement', async () => {
    // A bomb understates itself here. Listing repeats the claim; `read` is what
    // refuses to believe it.
    const zip = await buildZip([
      { name: 'a.txt', data: new Uint8Array(50_000), declaredSize: 10 },
    ]);

    expect(listZipEntries(zip)[0]).toMatchObject({ uncompressedSize: 10 });
    await expect(openZip(zip).read('a.txt', 1024)).rejects.toThrow(/inflates past/);
  });

  it('an entry name that looks like a path is just a string', async () => {
    // Nothing in this library resolves, opens or creates a file, so a traversal
    // name has nothing to traverse. The test pins that it is carried through
    // verbatim rather than normalised into something a careless caller might join
    // onto a directory.
    const zip = await buildZip([
      { name: '../../etc/passwd', data: encoder.encode('root:x:0:0') },
    ]);

    expect(listZipEntries(zip).map((e) => e.name)).toEqual(['../../etc/passwd']);
    expect(text(await openZip(zip).read('../../etc/passwd'))).toBe('root:x:0:0');
  });

  it('refuses an archive claiming more entries than the cap', async () => {
    const zip = await buildZip([{ name: 'a.txt', data: encoder.encode('x') }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // Rewrite the EOCD entry counts; the record is the last 22 bytes.
    view.setUint16(zip.byteLength - 22 + 10, 4096, true);

    expect(() => listZipEntries(zip)).toThrow(/limit 512/);
    expect(() => listZipEntries(zip, { maxEntries: 8192 })).toThrow(
      /malformed central directory/,
    );
  });
});

describe('openZip', () => {
  it('reads the directory once and serves every entry from it', async () => {
    const zip = await buildZip([
      { name: 'a.txt', data: encoder.encode('one') },
      { name: 'b.txt', data: encoder.encode('two') },
    ]);
    const archive = openZip(zip);

    expect(archive.entries).toHaveLength(2);
    expect(text(await archive.read('a.txt'))).toBe('one');
    expect(text(await archive.read('b.txt'))).toBe('two');
    expect(await archive.read('c.txt')).toBeUndefined();
  });
});

describe('zip-bomb defences (SECURITY.md T7)', () => {
  it('rejects an entry whose declared size is over the limit', async () => {
    const zip = await buildZip([
      {
        name: 'a.txt',
        data: encoder.encode('small'),
        declaredSize: MAX_ENTRY_BYTES + 1,
      },
    ]);
    await expect(readZipEntry(zip, 'a.txt')).rejects.toThrow(/limit/);
  });

  it('aborts inflation when the real output exceeds the cap, however the header lies', async () => {
    // 200 kB of zeroes deflates to almost nothing and declares itself as 10 bytes.
    const zip = await buildZip([
      { name: 'a.txt', data: new Uint8Array(200_000), declaredSize: 10 },
    ]);
    await expect(readZipEntry(zip, 'a.txt', 1024)).rejects.toThrow(/inflates past/);
  });

  it('caps a stored entry by its real length too', async () => {
    const zip = await buildZip([
      { name: 'a.txt', data: new Uint8Array(4096), method: 0, declaredSize: 10 },
    ]);
    await expect(readZipEntry(zip, 'a.txt', 1024)).rejects.toThrow(/limit/);
  });

  it('rejects an unsupported compression method rather than guessing', async () => {
    const zip = await buildZip([
      { name: 'a.txt', data: encoder.encode('x'), method: 12 },
    ]);
    await expect(readZipEntry(zip, 'a.txt')).rejects.toThrow(/compression method 12/);
  });
});
