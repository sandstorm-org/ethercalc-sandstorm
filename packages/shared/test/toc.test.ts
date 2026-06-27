import { describe, expect, it } from 'vitest';

import { parseTocGrid, parseTocSave } from '../src/toc.ts';

describe('parseTocGrid', () => {
  it('ignores invalid grids and malformed rows', () => {
    expect(parseTocGrid(null)).toEqual([]);
    expect(parseTocGrid([])).toEqual([]);
    expect(parseTocGrid([
      'not a row',
      [12, 'not a link'],
      ['/r.1', 12],
    ])).toEqual([
      { link: '/r.1', title: 'Sheet3', row: 3 },
    ]);
  });

  it('parses canonical headered TOCs with last duplicate winning', () => {
    expect(parseTocGrid([
      ['#url', '#title'],
      ['/r.1', 'Old'],
      ['/r.2', 'Second'],
      ['/r.1', 'First'],
    ])).toEqual([
      { link: '/r.1', title: 'First', row: 4 },
      { link: '/r.2', title: 'Second', row: 3 },
    ]);
  });

  it('accepts plain url/title TOC headers', () => {
    expect(parseTocGrid([
      ['url', 'title'],
      ['/r.1', ''],
      ['/r.2', 'Second'],
    ])).toEqual([
      { link: '/r.1', title: 'Sheet1', row: 2 },
      { link: '/r.2', title: 'Second', row: 3 },
    ]);
  });

  it('normalizes legacy headerless Sandstorm TOCs by sheet number and custom title', () => {
    expect(parseTocGrid([
      ['/sheet2', 'two'],
      ['/sheet1', 'Sheet1'],
      ['/sheet2', 'Sheet2'],
      ['/sheet3', 'Sheet3'],
    ])).toEqual([
      { link: '/sheet1', title: 'Sheet1', row: 2 },
      { link: '/sheet2', title: 'two', row: 1 },
      { link: '/sheet3', title: 'Sheet3', row: 4 },
    ]);
  });

  it('keeps a later custom title over an earlier default title', () => {
    expect(parseTocGrid([
      ['/sheet2', 'Sheet2'],
      ['/sheet2', 'two'],
    ])).toEqual([
      { link: '/sheet2', title: 'two', row: 2 },
    ]);
  });

  it('sorts legacy sheet links before other headerless TOC links', () => {
    expect(parseTocGrid([
      ['/book.2', 'Second'],
      ['/sheet1', 'Sheet1'],
      ['/book.1', 'First'],
    ])).toEqual([
      { link: '/sheet1', title: 'Sheet1', row: 2 },
      { link: '/book.2', title: 'Second', row: 1 },
      { link: '/book.1', title: 'First', row: 3 },
    ]);
  });

  it('ignores non-TOC grids', () => {
    expect(parseTocGrid([['A1', 'B1'], ['plain', 'data']])).toEqual([]);
  });
});

describe('parseTocSave', () => {
  it('ignores empty saves and rows without link cells', () => {
    expect(parseTocSave('')).toEqual([]);
    expect(parseTocSave('cell:B1:t:Title only\ncell:A2:t:/r.1')).toEqual([
      { link: '/r.1', title: 'Sheet2' },
    ]);
  });

  it('accepts plain url/title SocialCalc TOC headers', () => {
    const save = [
      'cell:A1:t:url',
      'cell:B1:t:title',
      'cell:A2:t:/r.1',
    ].join('\n');

    expect(parseTocSave(save)).toEqual([
      { link: '/r.1', title: 'Sheet1' },
    ]);
  });

  it('normalizes legacy headerless SocialCalc TOC saves', () => {
    const save = [
      'socialcalc:version:1.0',
      'cell:A1:t:/sheet2',
      'cell:B1:t:two',
      'cell:A2:t:/sheet1',
      'cell:B2:t:Sheet1',
      'cell:A3:t:/sheet2',
      'cell:B3:t:Sheet2',
      'cell:A4:t:/sheet3',
      'cell:B4:t:Sheet3',
    ].join('\n');

    expect(parseTocSave(save)).toEqual([
      { link: '/sheet1', title: 'Sheet1' },
      { link: '/sheet2', title: 'two' },
      { link: '/sheet3', title: 'Sheet3' },
    ]);
  });

  it('decodes SocialCalc save escapes in TOC cells', () => {
    expect(parseTocSave('cell:A1:t:#url\ncell:A2:t:/a\\cb\\bc\ncell:B2:t:T\\cn\\bx\\ny')).toEqual([
      { link: '/a:b\\c', title: 'T:n\\x\ny' },
    ]);
  });
});
