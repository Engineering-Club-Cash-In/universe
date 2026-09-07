import { describe, expect, it } from "bun:test";

/**
 * Estas pruebas arrancan el módulo de verdad, en un proceso aparte, porque lo
 * que se está afirmando es el ARRANQUE: `validateEnv()` corre al importar
 * `config/env.ts` y una sola vez por proceso, así que no se puede repetir
 * dentro del mismo test runner con distintos valores.
 */
function arrancar(vars: Record<string, string>): {
  arranco: boolean;
  frontendUrl: string;
  salida: string;
} {
  const proc = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      `import("${__dirname}/env.ts")` +
        `.then((m) => console.log("FRONTEND_URL=" + m.env.FRONTEND_URL))` +
        `.catch((e) => { console.error(e.message); process.exit(1); })`,
    ],
    env: {
      PATH: process.env.PATH ?? "",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      BETTER_AUTH_SECRET: "secreto-de-prueba",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      BETTER_AUTH_URL: "http://localhost:3000",
      CORS_ORIGIN: "https://portal.example",
      FRONTEND_URL: "https://portal.example",
      ...vars,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = proc.stdout.toString();
  const salida = stdout + proc.stderr.toString();

  return {
    arranco: proc.exitCode === 0,
    frontendUrl: (stdout.match(/FRONTEND_URL=(.*)/) ?? ["", ""])[1].trim(),
    salida,
  };
}

describe("FRONTEND_URL: una sola URL canónica", () => {
  it("arranca con un origen único", () => {
    const r = arrancar({ FRONTEND_URL: "https://portal.example" });

    expect(r.arranco).toBe(true);
    expect(r.frontendUrl).toBe("https://portal.example");
  });

  // El hueco que motiva el cambio: la comprobación miraba la LISTA PARSEADA
  // (`declaraVariosOrigenes`), que ignora las entradas vacías y deduplica, así
  // que estos dos valores pasaban y el enlace del correo salía como
  // `https://portal.example,/reset-password?token=…`.
  it("tumba el arranque con una coma suelta al final", () => {
    const r = arrancar({ FRONTEND_URL: "https://portal.example," });

    expect(r.arranco).toBe(false);
    expect(r.salida).toContain("FRONTEND_URL");
    expect(r.salida).toContain("https://portal.example,");
  });

  it("tumba el arranque con el mismo origen repetido", () => {
    const r = arrancar({
      FRONTEND_URL: "https://portal.example,https://portal.example",
    });

    expect(r.arranco).toBe(false);
    expect(r.salida).toContain("FRONTEND_URL");
  });

  it("tumba el arranque con dos dominios distintos", () => {
    const r = arrancar({ FRONTEND_URL: "https://a.com,https://b.com" });

    expect(r.arranco).toBe(false);
    expect(r.salida).toContain("FRONTEND_URL");
  });

  // Los `.env` arrastran espacios al copiar y pegar; no hay ambigüedad sobre a
  // dónde va la gente, así que se limpia en vez de tumbar.
  it("acepta y limpia los espacios alrededor", () => {
    const r = arrancar({ FRONTEND_URL: "  https://portal.example  " });

    expect(r.arranco).toBe(true);
    expect(r.frontendUrl).toBe("https://portal.example");
  });

  // La barra final es una URL válida y apunta al mismo sitio, así que pasa.
  // Pero el enlace se arma con `${FRONTEND_URL}/reset-password`, así que se
  // guarda canonizado para que no salga `https://portal.example//reset-…`.
  it("acepta la barra final y la quita del valor guardado", () => {
    const r = arrancar({ FRONTEND_URL: "https://portal.example/" });

    expect(r.arranco).toBe(true);
    expect(r.frontendUrl).toBe("https://portal.example");
  });

  // El host no distingue mayúsculas; canonizarlo no cambia a dónde va nadie.
  it("acepta el host en mayúsculas y lo canoniza", () => {
    const r = arrancar({ FRONTEND_URL: "https://PORTAL.Example.com" });

    expect(r.arranco).toBe(true);
    expect(r.frontendUrl).toBe("https://portal.example.com");
  });

  // `FRONTEND_URL` cae por default a `CORS_ORIGIN`: un `CORS_ORIGIN` que es
  // solo separadores deja la base del enlace en `,` y hoy no se queja nadie.
  it("tumba el arranque cuando el valor no tiene ningún origen", () => {
    const r = arrancar({ FRONTEND_URL: "", CORS_ORIGIN: "," });

    expect(r.arranco).toBe(false);
    expect(r.salida).toContain("FRONTEND_URL");
  });

  // Una ruta no es un origen. Quedarse con el origen y tirar la ruta es
  // exactamente el fallo que este archivo evita: arrancaría bien y mandaría a
  // la gente a una URL que nadie declaró.
  it("tumba el arranque cuando el valor trae una ruta", () => {
    const r = arrancar({ FRONTEND_URL: "https://portal.example/portal" });

    expect(r.arranco).toBe(false);
    expect(r.salida).toContain("FRONTEND_URL");
  });
});
