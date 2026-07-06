import puppeteer, { type Browser } from "puppeteer";

// Flags únicos para correr Chromium dentro del contenedor (sin dbus, sin GPU,
// /dev/shm limitado). Cualquier ajuste de flags se hace SOLO aquí.
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
  });
}
