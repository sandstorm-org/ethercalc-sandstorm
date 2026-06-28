import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HackFoldr,
  parseTocBody,
  tocRowsEqual,
  type FetchImpl,
} from '../src/Foldr.ts';

interface FakeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function makeFetch(
  responses: Array<{ ok?: boolean; json?: unknown; throwError?: boolean } | undefined>,
): { fetchImpl: FetchImpl; calls: FakeRequest[] } {
  const calls: FakeRequest[] = [];
  let i = 0;
  const fetchImpl: FetchImpl = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = init?.method ?? 'GET';
    const bodyIn = init?.body;
    calls.push({
      url,
      method,
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof bodyIn === 'string' ? bodyIn : undefined,
    });
    const r = responses[i++];
    if (!r || r.throwError) throw new Error('fake network failure');
    const ok = r.ok ?? true;
    const jsonPayload = r.json;
    return {
      ok,
      async json() {
        if (jsonPayload === '__THROW__') throw new Error('bad json');
        return jsonPayload;
      },
    } as unknown as Response;
  };
  return { fetchImpl, calls };
}

function postedCommands(call: FakeRequest | undefined): string[] {
  if (!call?.body) return [];
  return (JSON.parse(call.body) as { command: string[] }).command;
}

describe('HackFoldr', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('strips trailing slashes from the base URL', () => {
    const f = new HackFoldr('http://x///');
    expect(f.base).toBe('http://x');
  });

  it('defaults fetchImpl to global fetch when none given', () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      const f = new HackFoldr('http://x');
      void f.fetch('r');
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe('fetch()', () => {
    it('dedupes duplicate links, keeping the last server row (#727)', async () => {
      const { fetchImpl } = makeFetch([
        {
          json: [
            ['#url', '#title'],
            ['/r.1', 'Sheet1'],
            ['/r.1', 'Sheet1'],
            ['/r.2', 'Sheet2'],
          ],
        },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.rows).toEqual([
        { link: '/r.1', title: 'Sheet1', row: 3 },
        { link: '/r.2', title: 'Sheet2', row: 4 },
      ]);
    });

    it('parses a TOC response, dropping the header row', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#url', '#title'], ['/r.1', 'Sheet1'], ['/r.2', 'Sheet2']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(calls[0]?.url).toBe('http://x/_/r/csv.json');
      expect(f.rows).toEqual([
        { link: '/r.1', title: 'Sheet1', row: 2 },
        { link: '/r.2', title: 'Sheet2', row: 3 },
      ]);
    });

    it('parses legacy headerless Sandstorm TOCs', async () => {
      const { fetchImpl } = makeFetch([
        {
          json: [
            ['/sheet2', 'two'],
            ['/sheet1', 'Sheet1'],
            ['/sheet2', 'Sheet2'],
            ['/sheet3', 'Sheet3'],
          ],
        },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('sheet');
      expect(f.rows).toEqual([
        { link: '/sheet1', title: 'Sheet1', row: 2 },
        { link: '/sheet2', title: 'two', row: 1 },
        { link: '/sheet3', title: 'Sheet3', row: 4 },
      ]);
    });

    it('skips rows without a link and rows starting with #', async () => {
      const { fetchImpl } = makeFetch([
        {
          json: [
            ['#url', '#title'],
            ['', 'blank-link'],
            ['#note', 'note row'],
            ['/r.a', 'Real'],
          ],
        },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.rows).toEqual([{ link: '/r.a', title: 'Real', row: 4 }]);
    });

    it('defaults missing titles to SheetN (1-based counter)', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#u', '#t'], ['/r.1', ''], ['/r.2', '']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.rows.map((r) => r.title)).toEqual(['Sheet1', 'Sheet2']);
    });

    it('ignores non-array entries in the body', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#u', '#t'], 'not-a-row', ['/r.1', 'ok']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.rows).toEqual([{ link: '/r.1', title: 'ok', row: 3 }]);
    });

    it('coerces non-string link/title to empty string (skips empties)', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#u', '#t'], [1, 2], [null, null], ['/r.ok', undefined]] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.rows).toEqual([{ link: '/r.ok', title: 'Sheet3', row: 4 }]);
    });

    it('marks was-non-existent when the response is empty, and seeds Sheet1', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [] }, // empty body → non-existent
        { ok: true, json: null }, // TOC init commands
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.rows).toEqual([{ link: '/r.1', title: 'Sheet1', row: 2 }]);
      expect(f.wasNonExistent).toBe(false);
      expect(f.wasEmpty).toBe(false);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.method).toBe('POST');
      expect(calls[1]?.headers).toMatchObject({ 'content-type': 'application/json' });
      expect(postedCommands(calls[1])).toEqual([
        'set A1 text t #url',
        'set B1 text t #title',
        'set A2 text t /r.1',
        'set B2 text t Sheet1',
      ]);
    });

    it('seeds the Sandstorm workbook TOC room with /sheet1', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [] },
        { ok: true, json: null },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('sheet');
      expect(f.rows).toEqual([{ link: '/sheet1', title: 'Sheet1', row: 2 }]);
      expect(postedCommands(calls[1])).toEqual([
        'set A1 text t #url',
        'set B1 text t #title',
        'set A2 text t /sheet1',
        'set B2 text t Sheet1',
      ]);
    });

    it('marks was-empty when the TOC response has only a header', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#url', '#title']] },
        { ok: true, json: null }, // first TOC row commands
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.rows).toEqual([{ link: '/r.1', title: 'Sheet1', row: 2 }]);
      expect(f.wasEmpty).toBe(false);
      expect(postedCommands(calls[1])).toEqual([
        'set A1 text t #url',
        'set B1 text t #title',
        'set A2 text t /r.1',
        'set B2 text t Sheet1',
      ]);
    });

    it('initializes header and Sheet1 when an empty TOC exports as a blank grid', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['']] },
        { ok: true, json: null },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('sheet');
      expect(f.rows).toEqual([{ link: '/sheet1', title: 'Sheet1', row: 2 }]);
      expect(postedCommands(calls[1])).toEqual([
        'set A1 text t #url',
        'set B1 text t #title',
        'set A2 text t /sheet1',
        'set B2 text t Sheet1',
      ]);
    });

    it('survives a thrown fetch (treats as non-existent)', async () => {
      const { fetchImpl } = makeFetch([
        { throwError: true },
        { ok: true, json: null },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.rows).toEqual([{ link: '/r.1', title: 'Sheet1', row: 2 }]);
    });

    it('survives a !ok response (treats body as null → non-existent)', async () => {
      const { fetchImpl } = makeFetch([
        { ok: false },
        { ok: true, json: null },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.rows).toEqual([{ link: '/r.1', title: 'Sheet1', row: 2 }]);
    });
  });

  describe('size/lastIndex/lastRow/links/titles/at', () => {
    it('returns {} from lastRow/at when empty', async () => {
      const f = new HackFoldr('http://x', {
        fetchImpl: makeFetch([]).fetchImpl,
      });
      expect(f.size()).toBe(0);
      expect(f.lastIndex()).toBe(-1);
      expect(f.lastRow()).toEqual({});
      expect(f.at(0)).toEqual({});
      expect(f.links()).toEqual([]);
      expect(f.titles()).toEqual([]);
    });

    it('reports the correct counts after populate', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#', '#'], ['/a', 'A'], ['/b', 'B']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      expect(f.size()).toBe(2);
      expect(f.lastIndex()).toBe(1);
      expect(f.lastRow()).toMatchObject({ title: 'B' });
      expect(f.links()).toEqual(['/a', '/b']);
      expect(f.titles()).toEqual(['A', 'B']);
      expect(f.at(0)).toMatchObject({ title: 'A' });
      expect(f.at(99)).toEqual({});
    });
  });

  describe('push()', () => {
    it('posts explicit TOC cell commands and chooses the next row locally', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#', '#'], ['/a', 'A']] }, // fetch
        { ok: true, json: null }, // TOC command write
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.push({ link: '/new', title: 'New', row: 0 });
      expect(calls[1]?.headers).toMatchObject({ 'content-type': 'application/json' });
      expect(postedCommands(calls[1])).toEqual([
        'set A3 text t /new',
        'set B3 text t New',
      ]);
      expect(f.rows[1]).toMatchObject({ link: '/new', title: 'New', row: 3 });
    });

    it('chooses the next physical row after deduped ghost rows', async () => {
      const { fetchImpl, calls } = makeFetch([
        {
          json: [
            ['#url', '#title'],
            ['/r.1', 'Old'],
            ['/r.2', 'Second'],
            ['/r.1', 'First'],
          ],
        },
        { ok: true, json: null },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.push({ link: '/r.3', title: 'Third', row: 0 });
      expect(postedCommands(calls[1])).toEqual([
        'set A5 text t /r.3',
        'set B5 text t Third',
      ]);
      expect(f.rows[2]).toMatchObject({ link: '/r.3', title: 'Third', row: 5 });
    });

    it('survives a POST !ok and still appends locally', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#', '#'], ['/a', 'A']] },
        { ok: false },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.push({ link: '/n', title: 'N', row: 0 });
      expect(f.rows[1]).toMatchObject({ row: 3 });
    });

    it('survives a POST throw and still appends locally', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#', '#'], ['/a', 'A']] },
        { throwError: true },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.push({ link: '/n', title: 'N', row: 3 });
      expect(f.rows[1]).toMatchObject({ row: 3 });
    });

    it('posts a seed row, then appends after it, when pushing after an empty room fetch', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#url', '#title']] }, // empty
        { ok: true, json: null }, // seed row
        { ok: true, json: null }, // push
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.push({ link: '/x', title: 'X', row: 0 });
      expect(postedCommands(calls[1])).toEqual([
        'set A1 text t #url',
        'set B1 text t #title',
        'set A2 text t /r.1',
        'set B2 text t Sheet1',
      ]);
      expect(postedCommands(calls[2])).toEqual([
        'set A3 text t /x',
        'set B3 text t X',
      ]);
      expect(f.rows[1]).toMatchObject({ row: 3 });
    });

    it('encodes SocialCalc command values', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#', '#'], ['/a', 'A']] },
        { ok: true, json: null },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.push({ link: '/a:b\\c', title: 'T:t\\x\nz', row: 0 });
      expect(postedCommands(calls[1])).toEqual([
        'set A3 text t /a\\cb\\bc',
        'set B3 text t T\\ct\\bx\\nz',
      ]);
    });
  });

  describe('setAt()', () => {
    it('sends a title command when patch.title is defined', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#', '#'], ['/a', 'A']] },
        { ok: true, json: null },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.setAt(0, { title: 'Re:n\\amed\nx' });
      expect(calls[1]?.body).toBe('set B2 text t Re\\cn\\bamed\\nx');
      expect(f.at(0)).toMatchObject({ title: 'Re:n\\amed\nx' });
    });

    it('skips the command when no title patch is given', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#', '#'], ['/a', 'A']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.setAt(0, { link: '/a2' });
      expect(calls).toHaveLength(1); // only the initial fetch
      expect(f.at(0)).toMatchObject({ link: '/a2', title: 'A' });
    });

    it('no-ops when index is out of range', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#', '#'], ['/a', 'A']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.setAt(99, { title: 'x' });
      expect(calls).toHaveLength(1);
    });
  });

  describe('deleteAt()', () => {
    it('sends a multi-cascade empty command and removes the row', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#', '#'], ['/a', 'A'], ['/b', 'B']] },
        { ok: true, json: null },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.deleteAt(1);
      expect(calls[1]?.body).toBe('set A3:B3 empty multi-cascade');
      expect(f.rows).toHaveLength(1);
      expect(f.at(0)).toMatchObject({ title: 'A' });
    });

    it('no-ops when index is out of range', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [['#', '#'], ['/a', 'A']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.deleteAt(99);
      expect(calls).toHaveLength(1);
      expect(f.rows).toHaveLength(1);
    });
  });

  describe('sendCmd()', () => {
    it('survives a POST throw without rejecting', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#', '#'], ['/a', 'A']] },
        { throwError: true },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await expect(f.sendCmd('set A1 text t foo')).resolves.toBeUndefined();
    });
  });

  describe('was-non-existent init flow', () => {
    it('on first push after non-existent state, initializes TOC and appends after it', async () => {
      const { fetchImpl, calls } = makeFetch([
        { json: [] },
        { ok: true, json: null },
        { ok: true, json: null },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      await f.fetch('r');
      await f.push({ link: '/fresh', title: 'Fresh', row: 0 });
      expect(postedCommands(calls[1])).toEqual([
        'set A1 text t #url',
        'set B1 text t #title',
        'set A2 text t /r.1',
        'set B2 text t Sheet1',
      ]);
      expect(postedCommands(calls[2])).toEqual([
        'set A3 text t /fresh',
        'set B3 text t Fresh',
      ]);
      expect(f.rows[1]?.row).toBe(3);
    });

    it('sendCmd triggers lazy init when sheet was non-existent (no row)', async () => {
      // This tests the `initIfNeeded(null)` branch when wasNonExistent is still
      // true — which can only happen if a caller invokes `sendCmd` or `push`
      // before `fetch` settled. We set the flags by hand to exercise it.
      const { fetchImpl, calls } = makeFetch([
        { ok: true, json: null }, // lazy TOC init
        { ok: true, json: null }, // sendCmd post
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      f.id = 'r';
      f.wasNonExistent = true;
      await f.sendCmd('noop');
      expect(postedCommands(calls[0])).toEqual([
        'set A1 text t #url',
        'set B1 text t #title',
        'set A2 text t /r.1',
        'set B2 text t Sheet1',
      ]);
      expect(calls[1]?.body).toBe('noop');
    });

    it('sendCmd triggers lazy init when sheet was empty (no row)', async () => {
      const { fetchImpl, calls } = makeFetch([
        { ok: true, json: null }, // lazy first-row init
        { ok: true, json: null }, // sendCmd post
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      f.id = 'r';
      f.wasEmpty = true;
      await f.sendCmd('noop');
      expect(postedCommands(calls[0])).toEqual([
        'set A1 text t #url',
        'set B1 text t #title',
        'set A2 text t /r.1',
        'set B2 text t Sheet1',
      ]);
      expect(calls[1]?.body).toBe('noop');
    });
  });

  describe('parseTocBody()', () => {
    it('returns [] for non-array or empty input', () => {
      expect(parseTocBody(null)).toEqual([]);
      expect(parseTocBody([])).toEqual([]);
    });
  });

  describe('tocRowsEqual()', () => {
    it('compares link, title, and row index', () => {
      const a = [{ link: '/a', title: 'A', row: 2 }];
      const b = [{ link: '/a', title: 'A', row: 2 }];
      const c = [{ link: '/a', title: 'B', row: 2 }];
      expect(tocRowsEqual(a, b)).toBe(true);
      expect(tocRowsEqual(a, c)).toBe(false);
      expect(tocRowsEqual(a, [])).toBe(false);
    });
  });

  describe('refreshToc()', () => {
    it('returns false when id is unset', async () => {
      const f = new HackFoldr('http://x', { fetchImpl: makeFetch([]).fetchImpl });
      await expect(f.refreshToc()).resolves.toBe(false);
    });

    it('returns false and keeps rows on fetch failure', async () => {
      const { fetchImpl } = makeFetch([{ throwError: true }]);
      const f = new HackFoldr('http://x', { fetchImpl });
      f.id = 'r';
      f.rows = [{ link: '/r.1', title: 'Sheet1', row: 2 }];
      await expect(f.refreshToc()).resolves.toBe(false);
      expect(f.rows).toEqual([{ link: '/r.1', title: 'Sheet1', row: 2 }]);
    });

    it('returns false when the server TOC is unchanged', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#url', '#title'], ['/r.1', 'Sheet1'], ['/r.2', 'Sheet2']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      f.id = 'r';
      f.rows = [
        { link: '/r.1', title: 'Sheet1', row: 2 },
        { link: '/r.2', title: 'Sheet2', row: 3 },
      ];
      await expect(f.refreshToc()).resolves.toBe(false);
    });

    it('updates rows and returns true when a peer adds a tab', async () => {
      const { fetchImpl } = makeFetch([
        {
          json: [
            ['#url', '#title'],
            ['/r.1', 'Sheet1'],
            ['/r.2', 'Sheet2'],
            ['/r.3', 'PeerTab'],
          ],
        },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      f.id = 'r';
      f.rows = [
        { link: '/r.1', title: 'Sheet1', row: 2 },
        { link: '/r.2', title: 'Sheet2', row: 3 },
      ];
      await expect(f.refreshToc()).resolves.toBe(true);
      expect(f.rows).toEqual([
        { link: '/r.1', title: 'Sheet1', row: 2 },
        { link: '/r.2', title: 'Sheet2', row: 3 },
        { link: '/r.3', title: 'PeerTab', row: 4 },
      ]);
    });

    it('updates rows and returns true when a peer renames a tab', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#url', '#title'], ['/r.1', 'RenamedByPeer']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      f.id = 'r';
      f.rows = [{ link: '/r.1', title: 'Sheet1', row: 2 }];
      await expect(f.refreshToc()).resolves.toBe(true);
      expect(f.at(0)).toMatchObject({ title: 'RenamedByPeer' });
    });

    it('updates rows and returns true when a peer deletes a tab', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['#url', '#title'], ['/r.1', 'Sheet1']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      f.id = 'r';
      f.rows = [
        { link: '/r.1', title: 'Sheet1', row: 2 },
        { link: '/r.2', title: 'Gone', row: 3 },
      ];
      await expect(f.refreshToc()).resolves.toBe(true);
      expect(f.rows).toHaveLength(1);
    });

    it('keeps rows when a refresh returns a non-TOC spreadsheet body', async () => {
      const { fetchImpl } = makeFetch([
        { json: [['A1', 'B1'], ['plain sheet data', 'not a TOC']] },
      ]);
      const f = new HackFoldr('http://x', { fetchImpl });
      f.id = 'r';
      f.rows = [{ link: '/r.1', title: 'Sheet1', row: 2 }];
      await expect(f.refreshToc()).resolves.toBe(false);
      expect(f.rows).toEqual([{ link: '/r.1', title: 'Sheet1', row: 2 }]);
    });

    it('does not seed Sheet1 or flip init flags on refresh', async () => {
      const { fetchImpl } = makeFetch([{ json: [] }]);
      const f = new HackFoldr('http://x', { fetchImpl });
      f.id = 'r';
      f.rows = [{ link: '/r.1', title: 'Sheet1', row: 2 }];
      f.wasNonExistent = false;
      f.wasEmpty = false;
      await expect(f.refreshToc()).resolves.toBe(false);
      expect(f.rows).toEqual([{ link: '/r.1', title: 'Sheet1', row: 2 }]);
      expect(f.wasNonExistent).toBe(false);
      expect(f.wasEmpty).toBe(false);
    });
  });

});
