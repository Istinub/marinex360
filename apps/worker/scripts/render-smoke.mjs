/**
 * PDF render smoke (acceptance #4): renders a hello-world HTML page to PDF using the
 * Chromium baked into the worker image. Proves Phase-3 PDF generation (FR-41/46/53) won't
 * be a surprise. Run inside the worker image, or locally if Chromium is installed:
 *
 *   docker build -f apps/worker/Dockerfile -t marinex-worker .
 *   docker run --rm -v "$PWD/tmp:/app/tmp" marinex-worker node apps/worker/scripts/render-smoke.mjs
 *
 * Exits non-zero if the PDF is empty or Chromium can't launch.
 */
import puppeteer from "puppeteer-core";
import { writeFile, mkdir } from "node:fs/promises";

const execPath = process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium";
const outPath = "tmp/render-smoke.local.pdf";

const html = `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
  <h1>MarineX360</h1><p>PDF render smoke OK — ${new Date().toISOString()}</p></body></html>`;

const browser = await puppeteer.launch({
  executablePath: execPath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"], // container-friendly
});

try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  if (!pdf || pdf.length < 1000) {
    console.error(`FAIL — PDF too small (${pdf?.length ?? 0} bytes)`);
    process.exit(1);
  }
  await mkdir("tmp", { recursive: true });
  await writeFile(outPath, pdf);
  console.log(`PDF smoke OK: ${pdf.length} bytes -> ${outPath} (Chromium: ${execPath})`);
} finally {
  await browser.close();
}
