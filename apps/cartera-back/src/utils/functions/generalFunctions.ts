import { generarHTMLReporte } from "../../controllers/investor";
import { InversionistaReporte } from "../interface";
import puppeteer from "puppeteer";
export async function generarPDFBuffer(
  inversionista: InversionistaReporte,
  logoUrl: string = ""
): Promise<Buffer> {
  const html = generarHTMLReporte(inversionista, logoUrl);
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfData =await page.pdf({
  format: 'A4',
  landscape: true,
  printBackground: true,
  margin: { top: 20, bottom: 20, left: 12, right: 12 }
});

  await browser.close();
  return Buffer.from(pdfData);
}
