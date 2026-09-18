/** Verifica si Cloudflare deja pasar al navegador automatizado. */
import "dotenv/config";
import puppeteer, { type Cookie } from "puppeteer";
import { CHROMIUM_LAUNCH_ARGS } from "../lib/browser";

const targets = process.argv.slice(2);
if (targets.length === 0) targets.push("https://agenciavirtual.sat.gob.gt/");

const CHALLENGE_TITLES = ["just a moment", "attention required", "access denied", "un momento"];
const CHALLENGE_MARKERS = ["cf-browser-verification", "cf-error-details"];

type Veredicto = "OK" | "OK_TRAS_DESAFIO" | "CHALLENGE" | "BLOCKED" | "ERROR" | "FALLO";

function classify(params: {
	status: number;
	title: string;
	html: string;
	cookies: Cookie[];
}): Veredicto {
	const { status, title, html, cookies } = params;
	const lowerTitle = title.toLowerCase();
	const lowerHtml = html.toLowerCase();
	if (CHALLENGE_TITLES.some((item) => lowerTitle.includes(item))) return "CHALLENGE";
	if (CHALLENGE_MARKERS.some((item) => lowerHtml.includes(item))) return "CHALLENGE";
	if (status === 403) return "BLOCKED";
	if (status === 503) return "CHALLENGE";
	if (status >= 400) return "ERROR";
	if (cookies.some((cookie) => cookie.name === "cf_clearance")) return "OK_TRAS_DESAFIO";
	return "OK";
}

const browser = await puppeteer.launch({ headless: true, args: CHROMIUM_LAUNCH_ARGS });
const results: Array<Record<string, unknown>> = [];

for (const url of targets) {
	const page = await browser.newPage();
	try {
		const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
		await new Promise((resolve) => setTimeout(resolve, 6000));
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
				.filter((cookie) => cookie.name.startsWith("cf") || cookie.name.startsWith("__cf"))
				.map((cookie) => cookie.name),
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
const bloqueado = results.some((result) =>
	(["BLOCKED", "CHALLENGE", "FALLO", "ERROR"] as string[]).includes(String(result.veredicto)),
);
process.exit(bloqueado ? 1 : 0);
