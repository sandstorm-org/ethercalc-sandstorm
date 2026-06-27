import { describe, expect, it } from 'vitest';

import {
  type LegacyDiskMigrationEnv,
  migrateLegacyDisk,
  roomsFromLegacyDumpManifest,
  roomsFromLegacyJsonBlob,
} from '../src/handlers/legacy-disk-migrate.ts';
import { csvToSocialCalc } from '../src/lib/csv.ts';
import { encodeCSV } from '../src/lib/csv-encode.ts';

describe('roomsFromLegacyJsonBlob', () => {
  it('groups legacy Redis-style keys by room and applies timestamps', () => {
    const rooms = roomsFromLegacyJsonBlob(
      JSON.stringify({
        'snapshot-b': 'save-b',
        'log-b': ['l1'],
        'audit-b': ['a1'],
        'chat-b': ['c1'],
        'ecell-b': { alice: 'A1' },
        'snapshot-a': 'save-a',
        'snapshot-c': 'save-c',
        'snapshot-d': 'save-d',
        'snapshot-e': 'save-e',
        'log-a': 'ignored',
        'audit-a': [1],
        'chat-a': {},
        'ecell-a': { bob: 2 },
        'ecell-c': null,
        'ecell-d': [],
        'ecell-e': 'ignored',
        'snapshot-': 'ignored',
        'unknown-b': 'ignored',
        timestamps: {
          'timestamp-b': '123',
          a: 456,
          c: false,
        },
      }),
    );

    expect(rooms).toEqual([
      {
        name: 'a',
        snapshot: 'save-a',
        log: [],
        audit: ['1'],
        chat: [],
        ecell: {},
        updatedAt: 456,
      },
      {
        name: 'b',
        snapshot: 'save-b',
        log: ['l1'],
        audit: ['a1'],
        chat: ['c1'],
        ecell: { alice: 'A1' },
        updatedAt: 123,
      },
      {
        name: 'c',
        snapshot: 'save-c',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
      },
      {
        name: 'd',
        snapshot: 'save-d',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
      },
      {
        name: 'e',
        snapshot: 'save-e',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
      },
    ]);
  });

  it('ignores malformed timestamp containers', () => {
    const rooms = roomsFromLegacyJsonBlob(
      JSON.stringify({
        'snapshot-room': 'save',
        timestamps: [],
      }),
    );
    expect(rooms).toEqual([
      {
        name: 'room',
        snapshot: 'save',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
      },
    ]);
  });

  it('synthesizes a Sandstorm workbook TOC when legacy data only has sheet-number rooms', () => {
    const rooms = roomsFromLegacyJsonBlob(
      JSON.stringify({
        'snapshot-sheet1': 'save-1',
        'audit-sheet1': ['set A1 text t test'],
        'log-sheet': [],
      }),
    );

    expect(rooms.map((room) => room.name)).toEqual(['sheet', 'sheet1']);
    const toc = rooms.find((room) => room.name === 'sheet');
    expect(toc?.snapshot).toContain('cell:A1:t:#url');
    expect(toc?.snapshot).toContain('cell:B1:t:#title');
    expect(toc?.snapshot).toContain('cell:A2:t:/sheet1');
    expect(toc?.snapshot).toContain('cell:B2:t:Sheet1');
    expect(rooms.find((room) => room.name === 'sheet1')).toMatchObject({
      snapshot: 'save-1',
      audit: ['set A1 text t test'],
    });
  });

  it('synthesizes a Sandstorm workbook TOC without an existing placeholder TOC room', () => {
    const rooms = roomsFromLegacyJsonBlob(
      JSON.stringify({
        'snapshot-sheet1': 'save-1',
      }),
    );

    expect(rooms.find((room) => room.name === 'sheet')).toMatchObject({
      log: [],
      audit: [],
      chat: [],
      ecell: {},
    });
  });

  it('preserves existing empty TOC metadata when synthesizing a Sandstorm workbook TOC', () => {
    const rooms = roomsFromLegacyJsonBlob(
      JSON.stringify({
        'snapshot-sheet': '',
        'audit-sheet': ['audit-toc'],
        'chat-sheet': ['chat-toc'],
        'ecell-sheet': { alice: 'A1' },
        'snapshot-sheet1': 'save-1',
        timestamps: {
          'timestamp-sheet': 100,
          'timestamp-sheet1': 200,
        },
      }),
    );

    expect(rooms.find((room) => room.name === 'sheet')).toMatchObject({
      log: [],
      audit: ['audit-toc'],
      chat: ['chat-toc'],
      ecell: { alice: 'A1' },
      updatedAt: 200,
    });
  });

  it('preserves an existing Sandstorm workbook TOC snapshot', () => {
    const rooms = roomsFromLegacyJsonBlob(
      JSON.stringify({
        'snapshot-sheet': 'existing-toc',
        'snapshot-sheet1': 'save-1',
        'snapshot-sheet2': 'save-2',
      }),
    );

    expect(rooms.find((room) => room.name === 'sheet')?.snapshot).toBe('existing-toc');
  });

  it('normalizes an existing legacy Sandstorm workbook TOC snapshot', () => {
    const rooms = roomsFromLegacyJsonBlob(
      JSON.stringify({
        'snapshot-sheet': [
          'socialcalc:version:1.0',
          'cell:A1:t:/sheet2',
          'cell:B1:t:two',
          'cell:A2:t:/sheet1',
          'cell:B2:t:Sheet1',
          'cell:A3:t:/sheet2',
          'cell:B3:t:Sheet2',
          'cell:A4:t:/sheet3',
          'cell:B4:t:Sheet3',
          'sheet:c:2:r:4:tvf:1',
        ].join('\n'),
        'snapshot-sheet1': 'save-1',
        'snapshot-sheet2': 'save-2',
        'snapshot-sheet3': 'save-3',
      }),
    );

    const toc = rooms.find((room) => room.name === 'sheet');
    expect(toc?.snapshot).toContain('cell:A1:t:#url');
    expect(toc?.snapshot).toContain('cell:B1:t:#title');
    expect(toc?.snapshot).toContain('cell:A2:t:/sheet1');
    expect(toc?.snapshot).toContain('cell:B2:t:Sheet1');
    expect(toc?.snapshot).toContain('cell:A3:t:/sheet2');
    expect(toc?.snapshot).toContain('cell:B3:t:two');
    expect(toc?.snapshot).toContain('cell:A4:t:/sheet3');
    expect(toc?.snapshot).toContain('cell:B4:t:Sheet3');
  });

  it('folds TOC log entries before normalizing and clears the stale log', () => {
    const rooms = roomsFromLegacyJsonBlob(
      JSON.stringify({
        'snapshot-sheet': csvToSocialCalc(encodeCSV([
          ['#url', '#title'],
          ['/sheet1', 'Sheet1'],
          ['/sheet2', 'Sheet2'],
        ])),
        'log-sheet': ['set B3 text t two'],
        'snapshot-sheet1': 'save-1',
        'snapshot-sheet2': 'save-2',
      }),
    );

    const toc = rooms.find((room) => room.name === 'sheet');
    expect(toc?.snapshot).toContain('cell:A3:t:/sheet2');
    expect(toc?.snapshot).toContain('cell:B3:t:two');
    expect(toc?.log).toEqual([]);
  });

  it('normalizes log-only Sandstorm workbook TOCs instead of replaying the stale log', () => {
    const rooms = roomsFromLegacyJsonBlob(
      JSON.stringify({
        'log-sheet': [
          'set A1 text t /sheet2',
          'set B1 text t two',
          'set A2 text t /sheet1',
          'set B2 text t Sheet1',
        ],
        'snapshot-sheet1': 'save-1',
        'snapshot-sheet2': 'save-2',
      }),
    );

    const toc = rooms.find((room) => room.name === 'sheet');
    expect(toc?.snapshot).toContain('cell:A1:t:#url');
    expect(toc?.snapshot).toContain('cell:B1:t:#title');
    expect(toc?.snapshot).toContain('cell:A2:t:/sheet1');
    expect(toc?.snapshot).toContain('cell:B2:t:Sheet1');
    expect(toc?.snapshot).toContain('cell:A3:t:/sheet2');
    expect(toc?.snapshot).toContain('cell:B3:t:two');
    expect(toc?.log).toEqual([]);
  });
});

describe('roomsFromLegacyDumpManifest', () => {
  it('reads only validated dump txt basenames', async () => {
    const files = new Map([
      ['/dump/snapshot-z.txt', 'save-z'],
      ['/dump/audit-z.txt', 'one\\ntwo\\rthree\\\\four\n'],
      ['/dump/audit-y.txt', 'audit-y'],
    ]);

    const rooms = await roomsFromLegacyDumpManifest(
      [
        'snapshot-z.txt',
        'audit-z.txt',
        'audit-y.txt',
        '.hidden.txt',
        'notes.md',
        'nested/file.txt',
        'nested\\file.txt',
        '../escape.txt',
        'snapshot-dot..dot.txt',
        'snapshot-.txt',
        'chat-z.txt',
        'nodash.txt',
        '',
      ].join('\n'),
      async (path) => files.get(path) ?? null,
    );

    expect(rooms).toEqual([
      {
        name: 'y',
        snapshot: '',
        log: [],
        audit: ['audit-y'],
        chat: [],
        ecell: {},
      },
      {
        name: 'z',
        snapshot: 'save-z',
        log: [],
        audit: ['one\ntwo\rthree\\four'],
        chat: [],
        ecell: {},
      },
    ]);
  });

  it('treats missing listed files as empty legacy values', async () => {
    const rooms = await roomsFromLegacyDumpManifest(
      'snapshot-a.txt\r\naudit-a.txt\r\n',
      async () => null,
    );
    expect(rooms).toEqual([
      {
        name: 'a',
        snapshot: '',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
      },
    ]);
  });
});

describe('migrateLegacyDisk', () => {
  it('imports dump.json through DO seed and batches D1 index rows', async () => {
    const seedBodies: unknown[] = [];
    const d1 = makeD1();
    const env = makeEnv({
      legacyFiles: {
        '/dump.json': JSON.stringify({
          'snapshot-room': 'save',
          'log-room': ['log-ok', 'x'.repeat(121 * 1024)],
          'audit-room': ['ok', 'x'.repeat(121 * 1024)],
          'chat-room': ['chat-ok', 'x'.repeat(121 * 1024)],
          timestamps: { 'timestamp-room': 99 },
        }),
      },
      onSeed: async (_room, init) => {
        seedBodies.push(JSON.parse(String(init.body)));
        return new Response('OK', { status: 201 });
      },
      db: d1,
    });

    await expect(migrateLegacyDisk(env)).resolves.toEqual({
      rooms: 1,
      droppedEntries: 3,
    });
    expect(seedBodies).toEqual([
      {
        snapshot: 'save',
        log: ['log-ok'],
        audit: ['ok'],
        chat: ['chat-ok'],
        ecell: {},
        updatedAt: 99,
        skipIndex: true,
      },
    ]);
    expect(d1.rows).toEqual([{ room: 'room', updatedAt: 99 }]);
  });

  it('falls back to the launcher manifest when dump.json is absent', async () => {
    const seenRooms: string[] = [];
    const env = makeEnv({
      legacyFiles: {
        '/ethercalc-migrate-manifest.txt': 'snapshot-sheet.txt\n',
        '/dump/snapshot-sheet.txt': 'save',
      },
      onSeed: async (room) => {
        seenRooms.push(room);
        return new Response('OK', { status: 201 });
      },
    });

    await expect(migrateLegacyDisk(env)).resolves.toEqual({
      rooms: 1,
      droppedEntries: 0,
    });
    expect(seenRooms).toEqual(['sheet']);
  });

  it('treats a missing launcher manifest as an empty migration', async () => {
    const seenRooms: string[] = [];
    const env = makeEnv({
      onSeed: async (room) => {
        seenRooms.push(room);
        return new Response('OK', { status: 201 });
      },
    });

    await expect(migrateLegacyDisk(env)).resolves.toEqual({
      rooms: 0,
      droppedEntries: 0,
    });
    expect(seenRooms).toEqual([]);
  });

  it('surfaces legacy disk read failures', async () => {
    const env = makeEnv({
      legacyStatus: { '/dump.json': 500 },
    });
    await expect(migrateLegacyDisk(env)).rejects.toThrow(
      'read legacy /dump.json: 500',
    );
  });

  it('surfaces DO seed failures', async () => {
    const env = makeEnv({
      legacyFiles: {
        '/dump.json': JSON.stringify({ 'snapshot-room': 'save' }),
      },
      onSeed: async () => new Response('bad seed', { status: 400 }),
    });
    await expect(migrateLegacyDisk(env)).rejects.toThrow(
      'seed room: 400 bad seed',
    );
  });
});

function makeEnv(options: {
  legacyFiles?: Record<string, string>;
  legacyStatus?: Record<string, number>;
  onSeed?: (room: string, init: RequestInit) => Promise<Response>;
  db?: D1Database;
}): LegacyDiskMigrationEnv {
  const onSeed =
    options.onSeed ??
    (async () => {
      return new Response('OK', { status: 201 });
    });
  return {
    ROOM: {
      idFromName(name: string) {
        return name as unknown as DurableObjectId;
      },
      get(id: DurableObjectId) {
        return {
          fetch(input: RequestInfo | URL, init?: RequestInit) {
            const url = new URL(input instanceof Request ? input.url : String(input));
            return onSeed(url.searchParams.get('name') ?? String(id), init ?? {});
          },
        } as DurableObjectStub;
      },
    } as DurableObjectNamespace,
    ...(options.db !== undefined ? { DB: options.db } : {}),
    LEGACY: makeLegacyFetcher(options.legacyFiles ?? {}, options.legacyStatus ?? {}),
  };
}

function makeLegacyFetcher(
  files: Record<string, string>,
  status: Record<string, number>,
): Fetcher {
  return {
    fetch(input: RequestInfo | URL) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const code = status[url.pathname];
      if (code !== undefined) return Promise.resolve(new Response('', { status: code }));
      const body = files[url.pathname];
      if (body === undefined) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(new Response(body, { status: 200 }));
    },
    connect() {
      throw new Error('connect not implemented');
    },
  } as Fetcher;
}

function makeD1(): D1Database & { rows: Array<{ room: string; updatedAt: number }> } {
  const rows: Array<{ room: string; updatedAt: number }> = [];
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          for (let i = 0; i < args.length; i += 2) {
            rows.push({ room: String(args[i]), updatedAt: Number(args[i + 1]) });
          }
          expect(sql).toContain('INSERT INTO rooms');
          return {
            run: async () => ({}),
          };
        },
      };
    },
  } as unknown as D1Database & { rows: Array<{ room: string; updatedAt: number }> };
}
