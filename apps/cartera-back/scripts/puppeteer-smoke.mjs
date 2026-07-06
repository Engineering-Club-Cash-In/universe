import puppeteer from "puppeteer";

const launchArgs = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
];

try {
  const browser = await puppeteer.launch({
    headless: true,
    args: launchArgs,
  });
  const page = await browser.newPage();
  await page.setContent("<html><body><h1>Puppeteer OK</h1></body></html>", {
    waitUntil: "networkidle0",
  });
  const pdf = await page.pdf({ format: "letter" });
  await browser.close();

  if (!pdf || pdf.length < 1000) {
    throw new Error(`PDF smoke produced an unexpectedly small PDF: ${pdf?.length ?? 0} bytes`);
  }

  console.log(JSON.stringify({ ok: true, pdfBytes: pdf.length }));
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
}
