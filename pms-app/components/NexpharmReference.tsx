import React, { useEffect, useMemo, useState } from 'react';
import { referenceRows, sheetImages } from '../lib/nexpharm-book';
import type { Book, Sheet } from '../lib/workbook';

function ReferenceSheet({ book, sheet }: { book: Book; sheet: Sheet }) {
  const [page, setPage] = useState(0);
  const [pictures, setPictures] = useState<{ url: string; title: string }[]>([]);
  const { rows, columns } = useMemo(() => referenceRows(book, sheet), [book, sheet]);
  const pages = Math.max(1, Math.ceil(rows.length / 50));

  useEffect(() => {
    const images = sheetImages(book, sheet).map((image, index) => ({
      url: URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.type })),
      title: image.title || sheet.name + ' 이미지 ' + (index + 1),
    }));
    setPictures(images);
    return () => images.forEach(image => URL.revokeObjectURL(image.url));
  }, [book, sheet]);

  return <>
    {rows.length > 0 && <>
      <div className="nex-table-scroll" tabIndex={0} role="region" aria-label={sheet.name + ' 표'}>
        <table className="nex-reference-table">
          <thead><tr><th scope="col">행</th>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          <tbody>{rows.slice(page * 50, (page + 1) * 50).map(([row, values]) => <tr key={row}>
            <th scope="row">{row}</th>{columns.map(column => <td key={column}>{values.get(column) ?? ''}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      {pages > 1 && <div className="pagination"><span>{page + 1} / {pages}</span><div>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>이전 행</button>
        <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>다음 행</button>
      </div></div>}
    </>}
    {pictures.length > 0 && <div className="nex-reference-images">
      {pictures.map(picture => <figure key={picture.url}><img src={picture.url} alt={picture.title}/><figcaption>{picture.title}</figcaption></figure>)}
    </div>}
    {!rows.length && !pictures.length && <p className="nex-empty-detail">이 시트에 표시할 내용이 없습니다.</p>}
  </>;
}

export function NexpharmReference({ book }: { book: Book }) {
  const sheets = book.sheets.filter(sheet => !sheet.hidden);
  const [selected, setSelected] = useState(sheets[0].name);
  const sheet = sheets.find(item => item.name === selected) ?? sheets[0];
  return <section className="panel nex-reference">
    <div className="nex-sheet-picker"><label htmlFor="nex-sheet">참고 시트</label>
      <select id="nex-sheet" value={sheet.name} onChange={event => setSelected(event.target.value)}>
        {sheets.map(item => <option key={item.name}>{item.name}</option>)}
      </select>
    </div>
    <ReferenceSheet key={sheet.name} book={book} sheet={sheet}/>
  </section>;
}
