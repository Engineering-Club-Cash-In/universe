import puppeteer, { type Browser } from "puppeteer";

// Flags necesarios para ejecutar Chromium dentro del contenedor del CRM.
export const CHROMIUM_LAUNCH_ARGS = [
	"--no-sandbox",
	"--disable-setuid-sandbox",
	"--disable-dev-shm-usage",
	"--disable-gpu",
];

export async function launchBrowser(): Promise<Browser> {
	return puppeteer.launch({
		headless: true,
		args: CHROMIUM_LAUNCH_ARGS,
		executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
	});
}
