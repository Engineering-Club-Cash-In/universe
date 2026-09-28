import { expect, test } from "bun:test";

const flag = "NEXA_INTERNAL_PAYMENTS_ENABLED";
const script = `
  import config from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
  process.stdout.write(String(config.nexaInternalPaymentsEnabled));
`;

const readFlag = async (value?: string) => {
  const env = { ...process.env };
  if (value === undefined) delete env[flag];
  else env[flag] = value;

  const child = Bun.spawn([process.execPath, "-e", script], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

test("deshabilita pagos internos Nexa con el flag ausente o exactamente false", async () => {
  expect(await readFlag()).toEqual({ exitCode: 0, stdout: "false", stderr: "" });
  expect(await readFlag("false")).toEqual({ exitCode: 0, stdout: "false", stderr: "" });
});
