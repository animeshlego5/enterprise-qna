// Client-side PDF text extraction via pdfjs-dist.
// The PDF.js worker is loaded from the unpkg CDN to avoid bundler WASM issues.

export interface PdfPage {
  page: number;
  text: string;
}

export async function extractPdfPages(file: File): Promise<PdfPage[]> {
  const arrayBuffer = await file.arrayBuffer();

  // Dynamic import keeps pdfjs out of the server bundle.
  const pdfjs = await import("pdfjs-dist");

  // Point to the matching worker on the CDN — avoids bundler configuration.
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages: PdfPage[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = (content.items as { str: string }[])
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0) pages.push({ page: i, text });
  }

  return pages;
}
