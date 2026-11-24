export const localPdfMaxBytes = 25 * 1024 * 1024;
export const localPdfMaxPages = 500;
export const maxRecordTextLength = 2_000_000;

export class LocalPdfLimitError extends RangeError {}

export async function openLocalPdf(data) {
  if (data.byteLength > localPdfMaxBytes) throw new LocalPdfLimitError('PDF 超过 25 MB。');
  const pdfjs = await import('./pdf/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf/build/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({
    data,
    cMapUrl: new URL('./pdf/cmaps/', import.meta.url).href,
    standardFontDataUrl: new URL('./pdf/standard_fonts/', import.meta.url).href,
    enableScripting: false,
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useWasm: false
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > localPdfMaxPages) {
      throw new LocalPdfLimitError('PDF 超过 ' + localPdfMaxPages + ' 页。请分批读取。');
    }
    return task;
  } catch (error) {
    // Release the worker without replacing the original reader error.
    await task.destroy().catch(() => {});
    throw error;
  }
}

export async function readLocalPdfText(file, onPage) {
  const task = await openLocalPdf(await file.arrayBuffer());
  try {
    const pdf = await task.promise;
    const pages = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      onPage(number, pdf.numPages);
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str || '').join(' ');
        length += text.length + 1;
        if (length > maxRecordTextLength) {
          throw new LocalPdfLimitError('PDF 文字过长。可缩短记录查询范围，或分批粘贴表格文字。');
        }
        pages.push(text);
      } finally {
        page.cleanup();
      }
    }
    return pages.join('\n');
  } finally {
    await task.destroy().catch(() => {});
  }
}
