const localPdfMaxBytes = 25 * 1024 * 1024;
const localPdfMaxPages = 500;

class LocalPdfLimitError extends RangeError {}

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
