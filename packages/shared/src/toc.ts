export interface TocRow {
  readonly link: string;
  readonly title: string;
  readonly row: number;
}

export interface TocEntry {
  readonly link: string;
  readonly title: string;
}

export function parseTocGrid(body: unknown): TocRow[] {
  if (!Array.isArray(body)) return [];
  const header = body[0];
  const headerLink = Array.isArray(header) && typeof header[0] === 'string'
    ? header[0]
    : '';
  const hasHeader = isTocHeaderLink(headerLink);
  const rowsIn = (hasHeader ? body.slice(1) : body) as unknown[];
  const parsed: TocRow[] = [];
  rowsIn.forEach((raw, idx) => {
    if (!Array.isArray(raw)) return;
    if (typeof raw[0] !== 'string') return;
    const link = raw[0];
    let title = typeof raw[1] === 'string' ? raw[1] : '';
    if (!link.startsWith('/')) return;
    const physicalRow = idx + (hasHeader ? 2 : 1);
    if (!title) title = fallbackTitle(link, hasHeader ? idx + 1 : physicalRow);
    parsed.push({ link, title, row: physicalRow });
  });
  return hasHeader ? dedupeTocRowsLastWins(parsed) : normalizeHeaderlessLegacyToc(parsed);
}

export function parseTocSave(snapshot: string): TocEntry[] {
  const cells = new Map<number, { link?: string; title?: string }>();
  for (const line of snapshot.split('\n')) {
    const match = /^cell:([AB])([1-9]\d*):t:(.*)$/.exec(line);
    if (match === null) continue;
    const row = Number(match[2]);
    const existing = cells.get(row) ?? {};
    if (match[1] === 'A') {
      existing.link = decodeSaveText(match[3] as string);
    } else {
      existing.title = decodeSaveText(match[3] as string);
    }
    cells.set(row, existing);
  }

  const rawRows = Array.from(cells.entries()).sort((a, b) => a[0] - b[0]);
  const firstLink = rawRows[0]?.[1].link ?? '';
  const hasHeader = isTocHeaderLink(firstLink);
  const parsed: TocRow[] = [];
  rawRows.slice(hasHeader ? 1 : 0).forEach(([row, cell], idx) => {
    if (cell.link === undefined) return;
    const link = cell.link;
    let title = cell.title ?? '';
    if (!link.startsWith('/')) return;
    if (!title) title = fallbackTitle(link, hasHeader ? idx + 1 : row);
    parsed.push({ link, title, row });
  });

  const normalized = hasHeader
    ? dedupeTocRowsLastWins(parsed)
    : normalizeHeaderlessLegacyToc(parsed);
  return normalized.map(({ link, title }) => ({ link, title }));
}

function dedupeTocRowsLastWins(rows: readonly TocRow[]): TocRow[] {
  const byLink = new Map<string, number>();
  const deduped: TocRow[] = [];
  for (const row of rows) {
    const at = byLink.get(row.link);
    if (at !== undefined) {
      deduped[at] = row;
    } else {
      byLink.set(row.link, deduped.length);
      deduped.push(row);
    }
  }
  return deduped;
}

function normalizeHeaderlessLegacyToc(rows: readonly TocRow[]): TocRow[] {
  const byLink = new Map<string, TocRow>();
  for (const row of rows) {
    const existing = byLink.get(row.link);
    if (existing === undefined) {
      byLink.set(row.link, { ...row });
      continue;
    }
    const sheetNum = legacySheetLinkNumber(row.link);
    if (
      isDefaultSheetTitle(existing.title, sheetNum) &&
      !isDefaultSheetTitle(row.title, sheetNum)
    ) {
      byLink.set(row.link, { ...existing, title: row.title, row: row.row });
    }
  }
  return Array.from(byLink.values()).sort((a, b) => {
    const left = legacySheetLinkNumber(a.link);
    const right = legacySheetLinkNumber(b.link);
    const leftRank = left ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

function fallbackTitle(link: string, fallbackNumber: number): string {
  return `Sheet${legacySheetLinkNumber(link) ?? fallbackNumber}`;
}

function isTocHeaderLink(link: string): boolean {
  return link !== '' && !link.startsWith('/');
}

function legacySheetLinkNumber(link: string): number | null {
  const match = /^\/sheet([1-9]\d*)$/.exec(link);
  return match === null ? null : Number(match[1]);
}

function isDefaultSheetTitle(title: string, sheetNum: number | null): boolean {
  return sheetNum !== null && title === `Sheet${sheetNum}`;
}

function decodeSaveText(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\c/g, ':').replace(/\\b/g, '\\');
}
