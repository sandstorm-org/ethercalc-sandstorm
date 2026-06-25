import { describe, expect, it } from 'vitest';

import {
  ensureSandstormDefaultRoom,
  type LegacyDiskMigrationEnv,
  migrateLegacyDisk,
  roomsFromLegacyDumpManifest,
  roomsFromLegacyJsonBlob,
} from '../src/handlers/legacy-disk-migrate.ts';

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

describe('ensureSandstormDefaultRoom', () => {
  it('keeps an existing visible sheet1 room unchanged', () => {
    expect(
      ensureSandstormDefaultRoom([
        {
          name: 'other',
          snapshot: 'version:1.5\ncell:A1:t:other\n',
          log: [],
          audit: [],
          chat: [],
          ecell: {},
        },
        {
          name: 'sheet1',
          snapshot: 'version:1.5\ncell:A1:t:sheet1\n',
          log: [],
          audit: [],
          chat: [],
          ecell: {},
        },
      ]),
    ).toEqual([
      {
        name: 'other',
        snapshot: 'version:1.5\ncell:A1:t:other\n',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
      },
      {
        name: 'sheet1',
        snapshot: 'version:1.5\ncell:A1:t:sheet1\n',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
      },
    ]);
  });

  it('clones the best visible room into sheet1 when sheet1 is absent', () => {
    expect(
      ensureSandstormDefaultRoom([
        {
          name: 'abc123_formdata',
          snapshot: 'version:1.5\ncell:A1:t:formdata\n',
          log: [],
          audit: [],
          chat: [],
          ecell: {},
          updatedAt: 30,
        },
        {
          name: 'abc123',
          snapshot: 'version:1.5\ncell:A1:t:sheet\n',
          log: [],
          audit: ['audit'],
          chat: ['chat'],
          ecell: { alice: 'B2' },
          updatedAt: 20,
        },
      ]),
    ).toEqual([
      {
        name: 'abc123',
        snapshot: 'version:1.5\ncell:A1:t:sheet\n',
        log: [],
        audit: ['audit'],
        chat: ['chat'],
        ecell: { alice: 'B2' },
        updatedAt: 20,
      },
      {
        name: 'abc123_formdata',
        snapshot: 'version:1.5\ncell:A1:t:formdata\n',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
        updatedAt: 30,
      },
      {
        name: 'sheet1',
        aliasOf: 'abc123',
        snapshot: 'version:1.5\ncell:A1:t:sheet\n',
        log: [],
        audit: ['audit'],
        chat: ['chat'],
        ecell: { alice: 'B2' },
        updatedAt: 20,
      },
    ]);
  });

  it('uses the local sheet linked from a legacy #url/#title index', () => {
    expect(
      ensureSandstormDefaultRoom([
        {
          name: 'sheet',
          snapshot: [
            'version:1.5',
            'cell:A1:t:#url',
            'cell:B1:t:#title',
            'cell:A2:t:/sheet.1',
            'cell:B2:t:Sheet1',
            'sheet:c:2:r:2:tvf:1',
            '',
          ].join('\n'),
          log: [],
          audit: [],
          chat: [],
          ecell: {},
          updatedAt: 20,
        },
        {
          name: 'sheet.1',
          snapshot: 'version:1.5\ncell:A1:t:real-data\n',
          log: [],
          audit: ['real-audit'],
          chat: [],
          ecell: {},
          updatedAt: 10,
        },
        {
          name: 'sheet.1_formdata',
          snapshot: 'version:1.5\ncell:A1:t:formdata\n',
          log: [],
          audit: [],
          chat: [],
          ecell: {},
          updatedAt: 30,
        },
      ]),
    ).toEqual([
      {
        name: 'sheet',
        snapshot: [
          'version:1.5',
          'cell:A1:t:#url',
          'cell:B1:t:#title',
          'cell:A2:t:/sheet.1',
          'cell:B2:t:Sheet1',
          'sheet:c:2:r:2:tvf:1',
          '',
        ].join('\n'),
        log: [],
        audit: [],
        chat: [],
        ecell: {},
        updatedAt: 20,
      },
      {
        name: 'sheet.1',
        snapshot: 'version:1.5\ncell:A1:t:real-data\n',
        log: [],
        audit: ['real-audit'],
        chat: [],
        ecell: {},
        updatedAt: 10,
      },
      {
        name: 'sheet.1_formdata',
        snapshot: 'version:1.5\ncell:A1:t:formdata\n',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
        updatedAt: 30,
      },
      {
        name: 'sheet1',
        aliasOf: 'sheet.1',
        snapshot: 'version:1.5\ncell:A1:t:real-data\n',
        log: [],
        audit: ['real-audit'],
        chat: [],
        ecell: {},
        updatedAt: 10,
      },
    ]);
  });

  it('does not treat arbitrary rooms as legacy Sandstorm indexes', () => {
    expect(
      ensureSandstormDefaultRoom([
        {
          name: 'notes',
          snapshot: [
            'version:1.5',
            'cell:A1:t:#url',
            'cell:A2:t:/target',
            'sheet:c:1:r:2:tvf:1',
            '',
          ].join('\n'),
          log: [],
          audit: [],
          chat: [],
          ecell: {},
          updatedAt: 50,
        },
        {
          name: 'target',
          snapshot: 'version:1.5\ncell:A1:t:target-data\n',
          log: [],
          audit: [],
          chat: [],
          ecell: {},
          updatedAt: 10,
        },
      ]),
    ).toEqual([
      {
        name: 'notes',
        snapshot: [
          'version:1.5',
          'cell:A1:t:#url',
          'cell:A2:t:/target',
          'sheet:c:1:r:2:tvf:1',
          '',
        ].join('\n'),
        log: [],
        audit: [],
        chat: [],
        ecell: {},
        updatedAt: 50,
      },
      {
        name: 'sheet1',
        aliasOf: 'notes',
        snapshot: [
          'version:1.5',
          'cell:A1:t:#url',
          'cell:A2:t:/target',
          'sheet:c:1:r:2:tvf:1',
          '',
        ].join('\n'),
        log: [],
        audit: [],
        chat: [],
        ecell: {},
        updatedAt: 50,
      },
      {
        name: 'target',
        snapshot: 'version:1.5\ncell:A1:t:target-data\n',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
        updatedAt: 10,
      },
    ]);
  });

  it('replaces an empty sheet1 with the newest visible non-formdata room', () => {
    expect(
      ensureSandstormDefaultRoom([
        {
          name: 'older',
          snapshot: 'version:1.5\ncell:A1:t:older\n',
          log: [],
          audit: [],
          chat: [],
          ecell: {},
          updatedAt: 10,
        },
        {
          name: 'sheet1',
          snapshot: '',
          log: [],
          audit: [],
          chat: [],
          ecell: {},
        },
        {
          name: 'newer',
          snapshot: '',
          log: ['set A1 value n 1'],
          audit: [],
          chat: [],
          ecell: {},
          updatedAt: 50,
        },
      ]),
    ).toEqual([
      {
        name: 'newer',
        snapshot: '',
        log: ['set A1 value n 1'],
        audit: [],
        chat: [],
        ecell: {},
        updatedAt: 50,
      },
      {
        name: 'older',
        snapshot: 'version:1.5\ncell:A1:t:older\n',
        log: [],
        audit: [],
        chat: [],
        ecell: {},
        updatedAt: 10,
      },
      {
        name: 'sheet1',
        aliasOf: 'newer',
        snapshot: '',
        log: ['set A1 value n 1'],
        audit: [],
        chat: [],
        ecell: {},
        updatedAt: 50,
      },
    ]);
  });

  it('does not create sheet1 when no room has visible spreadsheet state', () => {
    expect(
      ensureSandstormDefaultRoom([
        {
          name: 'audit-only',
          snapshot: '',
          log: [],
          audit: ['audit'],
          chat: [],
          ecell: {},
        },
      ]),
    ).toEqual([
      {
        name: 'audit-only',
        snapshot: '',
        log: [],
        audit: ['audit'],
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
          'snapshot-room': 'version:1.5\ncell:A1:t:save\n',
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
      rooms: 2,
      droppedEntries: 3,
      roomNames: ['room', 'sheet1<=room'],
    });
    expect(seedBodies).toEqual([
      {
        snapshot: 'version:1.5\ncell:A1:t:save\n',
        log: ['log-ok'],
        audit: ['ok'],
        chat: ['chat-ok'],
        ecell: {},
        updatedAt: 99,
        skipIndex: true,
      },
      {
        snapshot: 'version:1.5\ncell:A1:t:save\n',
        log: ['log-ok'],
        audit: ['ok'],
        chat: ['chat-ok'],
        ecell: {},
        updatedAt: 99,
        skipIndex: true,
      },
    ]);
    expect(d1.rows).toEqual([
      { room: 'room', updatedAt: 99 },
      { room: 'sheet1', updatedAt: 99 },
    ]);
  });

  it('falls back to the launcher manifest when dump.json is absent', async () => {
    const seenRooms: string[] = [];
    const env = makeEnv({
      legacyFiles: {
        '/ethercalc-migrate-manifest.txt': 'snapshot-sheet.txt\n',
        '/dump/snapshot-sheet.txt': 'version:1.5\ncell:A1:t:save\n',
      },
      onSeed: async (room) => {
        seenRooms.push(room);
        return new Response('OK', { status: 201 });
      },
    });

    await expect(migrateLegacyDisk(env)).resolves.toEqual({
      rooms: 2,
      droppedEntries: 0,
      roomNames: ['sheet', 'sheet1<=sheet'],
    });
    expect(seenRooms).toEqual(['sheet', 'sheet1']);
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
      roomNames: [],
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
