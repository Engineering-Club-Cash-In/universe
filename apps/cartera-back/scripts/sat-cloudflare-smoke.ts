/**
 * Verifica si Cloudflare deja pasar al navegador automatizado.
 * Uso: bun scripts/sat-cloudflare-smoke.ts [url...]
 * Correr en el SERVIDOR: desde una laptop siempre pasa y no prueba nada.
 */
import puppeteer, { type Cookie } from "puppeteer";
import { CHROMIUM_LAUNCH_ARGS } from "../src/utils/functions/browser";

const targets = process.argv.slice(2);
if (targets.length === 0) {
  targets.push("https://agenciavirtual.sat.gob.gt/");
}

const CHALLENGE_TITLES = ["just a moment", "attention required", "access denied", "un momento"];

// Solo marcadores del interstitial real. "challenge-platform" se inyecta
// también en páginas normales y daba falso positivo.
const CHALLENGE_MARKERS = ["cf-browser-verification", "cf-error-details"];

type Veredicto = "OK" | "OK_TRAS_DESAFIO" | "CHALLENGE" | "BLOCKED" | "ERROR" | "FALLO";

interface Resultado {
  url: string;
  status?: number;
  title?: string;
  veredicto: Veredicto;
  cookiesCloudflare?: string[];
  captura?: string;
  htmlBytes?: number;
  error?: string;
}

function classify(params: {
  status: number;
  title: string;
  html: string;
  cookies: Cookie[];
}): Veredicto {
  const { status, title, html, cookies } = params;
  const lowerTitle = title.toLowerCase();
  const lowerHtml = html.toLowerCase();

  if (CHALLENGE_TITLES.some((t) => lowerTitle.includes(t))) return "CHALLENGE";
  if (CHALLENGE_MARKERS.some((m) => lowerHtml.includes(m))) return "CHALLENGE";
  if (status === 403) return "BLOCKED";
  if (status === 503) return "CHALLENGE";
  if (status >= 400) return "ERROR";
  if (cookies.some((c) => c.name === "cf_clearance")) return "OK_TRAS_DESAFIO";
  return "OK";
}

const browser = await puppeteer.launch({ headless: true, args: CHROMIUM_LAUNCH_ARGS });
const results: Resultado[] = [];

for (const url of targets) {
  const page = await browser.newPage();
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // El desafío de Cloudflare se resuelve solo tras unos segundos.
    await new Promise((r) => setTimeout(r, 6000));

    const status = response?.status() ?? 0;
    const title = await page.title();
    const html = await page.content();
    const cookies = await page.cookies();
    const captura = `sat-smoke-${new URL(url).hostname}.png`;
    await page.screenshot({ path: captura });

    results.push({
      url,
      status,
      title,
      veredicto: classify({ status, title, html, cookies }),
      cookiesCloudflare: cookies
        .filter((c) => c.name.startsWith("cf") || c.name.startsWith("__cf"))
        .map((c) => c.name),
      captura,
      htmlBytes: html.length,
    });
  } catch (error) {
    results.push({
      url,
      veredicto: "FALLO",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await page.close();
  }
}

await browser.close();
console.log(JSON.stringify({ results }, null, 2));

const bloqueado = results.some((r) =>
  (["BLOCKED", "CHALLENGE", "FALLO", "ERROR"] as Veredicto[]).includes(r.veredicto),
);
process.exit(bloqueado ? 1 : 0);
