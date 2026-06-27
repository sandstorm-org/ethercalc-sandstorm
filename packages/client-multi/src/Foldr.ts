import { parseTocGrid } from '@ethercalc/shared/toc';

/**
 * Port of `multi/foldr.ls` (`HackFoldr`) from LiveScript/superagent to TS/fetch.
 *
 * Semantics preserved:
 *   - Strip trailing slashes from `base` on construction.
 *   - `fetch(id)` GETs `{base}/_/{id}/csv.json`, drops the header row, and
 *     builds `rows = [{link, title, row}]` for each body row where the link
 *     is slash-prefixed. Canonical TOCs have a `#…` header in row 1; legacy
 *     Sandstorm TOCs can be headerless, so parsing preserves physical row
 *     numbers from whichever row each link occupies. Missing titles become
 *     `SheetN` where `N` is the physical row number minus one for canonical
 *     TOCs, or the physical row number for headerless legacy TOCs.
 *   - If the room was never-before-seen, the first write initializes a
 *     `#url/#title` TOC header and the first row.
 *   - If the room is known but empty, the first push writes the first row.
 *   - `push(row)` appends a row by POSTing explicit SocialCalc commands.
 *   - `setAt(idx, {title})` sends `set B{row} text t {title}` via POST.
 *   - `deleteAt(idx)` sends `set A{row}:B{row} empty multi-cascade`.
 *
 * Any behavior below not marked "legacy bug" is a faithful port.
 *
 * Error handling: the legacy code silently ignored POST failures (the
 * superagent callback didn't check status). We preserve that — HTTP errors
 * don't throw, and the UI still updates its local TOC optimistically.
 */

export interface FoldrRow {
  link: string;
  title: string;
  row: number;
}

export type FetchImpl = typeof fetch;

export interface FoldrOptions {
  /** Override `fetch` (e.g. test mock). Defaults to the global `fetch`. */
  readonly fetchImpl?: FetchImpl;
}

/**
 * `HackFoldr` — the name is kept from the legacy source for grep-ability.
 * This class is intentionally framework-free so it can be unit-tested
 * exhaustively without a DOM.
 */
export class HackFoldr {
  readonly base: string;
  id = '';
  rows: FoldrRow[] = [];
  wasNonExistent = false;
  wasEmpty = false;
  private readonly fetchImpl: FetchImpl;

  constructor(base: string, options: FoldrOptions = {}) {
    this.base = base.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  size(): number {
    return this.rows.length;
  }

  lastIndex(): number {
    return this.rows.length - 1;
  }

  lastRow(): { link?: string; title?: string; row?: number } {
    return this.rows.length ? (this.rows[this.rows.length - 1] as FoldrRow) : {};
  }

  links(): string[] {
    return this.rows.map((r) => r.link);
  }

  titles(): string[] {
    return this.rows.map((r) => r.title);
  }

  at(idx: number): { link?: string; title?: string; row?: number } {
    return this.rows[idx] ?? {};
  }

  /**
   * Load TOC from the CSV-as-JSON endpoint. Resolves when the Foldr is ready.
   */
  async fetch(id: string): Promise<this> {
    this.id = id;
    const body = await this.loadTocJson();
    if (Array.isArray(body) && body.length > 0) {
      this.rows = parseTocBody(body);
    } else {
      this.wasNonExistent = true;
    }

    if (this.rows.length === 0) {
      this.wasEmpty = true;
      const seed: FoldrRow = { link: this.defaultFirstSheetLink(), title: 'Sheet1', row: 2 };
      this.rows = [];
      await this.push(seed);
    }
    return this;
  }

  /**
   * Re-fetch the TOC without seeding or touching init flags. Returns `true`
   * when the in-memory row list changed (add/rename/delete from a peer).
   */
  async refreshToc(): Promise<boolean> {
    if (!this.id) return false;
    const body = await this.loadTocJson();
    if (!Array.isArray(body) || body.length === 0) return false;
    const next = parseTocBody(body);
    // A multi workbook TOC should never have zero sheet rows in normal use
    // (the UI disables deleting the final tab). If a grain is accidentally
    // opened as `=plainSheet`, the CSV export is a valid array but not a TOC;
    // do not let the poller erase the locally seeded tab strip.
    if (next.length === 0 && this.rows.length > 0) return false;
    if (tocRowsEqual(this.rows, next)) return false;
    this.rows = next;
    return true;
  }

  private async loadTocJson(): Promise<unknown> {
    const url = `${this.base}/_/${this.id}/csv.json`;
    try {
      const res = await this.fetchImpl(url);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /** Append a new row (writes to server, then pushes locally). */
  async push(row: FoldrRow): Promise<this> {
    const rowWritten = await this.initIfNeeded(row);
    if (!rowWritten) {
      row.row = this.nextTocRow();
      await this.setTocRow(row.row, row.link, row.title);
    }
    this.rows.push(row);
    return this;
  }

  /**
   * Update a row in-place. When `title` is set, dispatches a
   * `set B<row> text t <title>` command to the server. Returns `this`.
   */
  async setAt(idx: number, patch: Partial<FoldrRow>): Promise<this> {
    const existing = this.rows[idx];
    if (!existing) return this;
    if (patch.title !== undefined) {
      await this.sendCmd(`set B${existing.row} text t ${encodeForSave(patch.title)}`);
    }
    Object.assign(existing, patch);
    return this;
  }

  /**
   * Remove a row. Sends `set A<row>:B<row> empty multi-cascade` to let the
   * server cascade-clear the TOC entry + its associated sub-sheet blob.
   */
  async deleteAt(idx: number): Promise<this> {
    const existing = this.rows[idx];
    if (!existing) return this;
    await this.sendCmd(`set A${existing.row}:B${existing.row} empty multi-cascade`);
    this.rows.splice(idx, 1);
    return this;
  }

  /** Send a raw SocialCalc command string via text/plain POST. */
  async sendCmd(cmd: string): Promise<void> {
    await this.initIfNeeded(null);
    try {
      await this.fetchImpl(`${this.base}/_/${this.id}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: cmd,
      });
    } catch {
      // Legacy swallowed errors silently.
    }
  }

  private async initIfNeeded(row: FoldrRow | null): Promise<boolean> {
    if (this.wasNonExistent) {
      this.wasNonExistent = false;
      this.wasEmpty = false;
      if (row) {
        row.row = 2;
        await this.sendCommands([
          ...tocRowCommands(1, '#url', '#title'),
          ...tocRowCommands(row.row, row.link, row.title),
        ]);
        return true;
      } else {
        await this.sendCommands([
          ...tocRowCommands(1, '#url', '#title'),
          ...tocRowCommands(2, this.defaultFirstSheetLink(), 'Sheet1'),
        ]);
        return false;
      }
    }
    if (this.wasEmpty) {
      this.wasEmpty = false;
      if (row) {
        row.row = 2;
        await this.sendCommands([
          ...tocRowCommands(1, '#url', '#title'),
          ...tocRowCommands(row.row, row.link, row.title),
        ]);
        return true;
      } else {
        await this.sendCommands([
          ...tocRowCommands(1, '#url', '#title'),
          ...tocRowCommands(2, this.defaultFirstSheetLink(), 'Sheet1'),
        ]);
        return false;
      }
    }
    return false;
  }

  private defaultFirstSheetLink(): string {
    return this.id === 'sheet' ? '/sheet1' : `/${this.id}.1`;
  }

  private nextTocRow(): number {
    const maxRow = this.rows.reduce((max, row) => {
      return Math.max(max, row.row);
    }, 1);
    return Math.max(maxRow + 1, this.rows.length + 2);
  }

  private async setTocRow(row: number, link: string, title: string): Promise<void> {
    await this.sendCommands(tocRowCommands(row, link, title));
  }

  private async sendCommands(commands: readonly string[]): Promise<void> {
    try {
      await this.fetchImpl(`${this.base}/_/${this.id}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ command: commands }),
      });
    } catch {
      // Legacy swallowed TOC write errors silently.
    }
  }
}

/**
 * Parse a `csv.json` body (array-of-arrays) into deduped TOC rows.
 * Exported for unit tests; `fetch` and `refreshToc` both use this.
 */
export function parseTocBody(body: unknown): FoldrRow[] {
  return parseTocGrid(body).map(({ link, title, row }) => ({ link, title, row }));
}

/** Shallow compare of two TOC row lists (link, title, row index). */
export function tocRowsEqual(a: readonly FoldrRow[], b: readonly FoldrRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.link !== right.link || left.title !== right.title || left.row !== right.row) {
      return false;
    }
  }
  return true;
}

function tocRowCommands(row: number, link: string, title: string): string[] {
  return [
    `set A${row} text t ${encodeForSave(link)}`,
    `set B${row} text t ${encodeForSave(title)}`,
  ];
}

function encodeForSave(s: string): string {
  return s.replace(/\\/g, '\\b').replace(/:/g, '\\c').replace(/\n/g, '\\n');
}
