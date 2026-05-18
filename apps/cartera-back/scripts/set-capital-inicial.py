#!/usr/bin/env python3
"""
Actualiza cartera.creditos_inversionistas_espejo.monto_aportado con base en
los valores del archivo `src/scripts/capital inicial.txt`.

Fórmula:
    nuevo_monto_aportado = <monto_del_archivo> - abono_capital_del_ultimo_pago_espejo

Donde el último pago espejo es el de mayor `fecha_pago` en
`cartera.pagos_credito_inversionistas_espejo` para ese `(credito_id, inversionista_id)`.

Formato del archivo (TAB-separado, 3 columnas):
    <cliente>\t<inversionista>\t<monto>

`<monto>` puede venir como:  "Q 9.834,32"  |  "8686,74"  |  "Q247,97"

Lógica de matching:
    usuario_id      ← cartera.usuarios.nombre        (unaccent + lower + trim)
    inversionista_id ← cartera.inversionistas.nombre (unaccent + lower + trim)
    credito_id      ← cartera.creditos WHERE usuario_id = ?
    espejo          ← cartera.creditos_inversionistas_espejo (credito_id, inversionista_id)

Si el cliente tiene >1 crédito con el mismo inv → AMBIGUO, no actualiza.

Uso:
    python3 scripts/set-capital-inicial.py            # dry-run (default)
    python3 scripts/set-capital-inicial.py apply      # ejecuta UPDATE
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
INPUT = REPO / "src" / "scripts" / "capital inicial.txt"


def get_db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if url:
        return url
    env_file = REPO / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("SUPABASE_DB_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    print("ERROR: SUPABASE_DB_URL no encontrado", file=sys.stderr)
    sys.exit(1)


def parse_monto(raw: str) -> float:
    """ 'Q 9.834,32' -> 9834.32 ;  '8686,74' -> 8686.74 ;  'Q247,97' -> 247.97 """
    s = raw.strip().replace("Q", "").replace(" ", "")
    s = s.replace(".", "").replace(",", ".")
    return float(s)


def sql_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "dry-run"
    if mode not in ("dry-run", "apply"):
        print(f"ERROR: modo inválido '{mode}' (usar 'dry-run' o 'apply')", file=sys.stderr)
        sys.exit(1)

    db_url = get_db_url()

    rows: list[tuple[int, str, str, float, str]] = []
    for ln, line in enumerate(INPUT.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            print(f"WARN ln{ln}: menos de 3 columnas → '{line}'", file=sys.stderr)
            continue
        cliente = parts[0].strip()
        inv = parts[1].strip()
        monto_raw = parts[2].strip()
        try:
            monto = parse_monto(monto_raw)
        except ValueError:
            print(f"WARN ln{ln}: monto inválido '{monto_raw}'", file=sys.stderr)
            continue
        rows.append((ln, cliente, inv, monto, monto_raw))

    if not rows:
        print("Nada que procesar.", file=sys.stderr)
        sys.exit(1)

    print(f"Filas leídas: {len(rows)}")
    print(f"Modo:        {mode}")
    print()

    values_sql = ",\n  ".join(
        f"({ln}, {sql_quote(c)}, {sql_quote(i)}, {m:.8f}::numeric)"
        for ln, c, i, m, _ in rows
    )

    cte = f"""
WITH ti(ln, cliente, inv, monto_file) AS (
  VALUES
  {values_sql}
),
m AS (
  SELECT ti.ln, ti.cliente AS cliente_in, ti.inv AS inv_in, ti.monto_file,
         u.usuario_id, u.nombre AS cliente_db,
         i.inversionista_id, i.nombre AS inv_db,
         c.credito_id, c.numero_credito_sifco,
         cie.id AS espejo_id, cie.monto_aportado AS monto_actual,
         -- abono_capital del último pago espejo (por fecha_pago)
         (
           SELECT p.abono_capital
           FROM cartera.pagos_credito_inversionistas_espejo p
           WHERE p.credito_id = cie.credito_id
             AND p.inversionista_id = cie.inversionista_id
           ORDER BY p.fecha_pago DESC, p.id DESC
           LIMIT 1
         ) AS ultimo_abono_capital,
         (
           SELECT p.id
           FROM cartera.pagos_credito_inversionistas_espejo p
           WHERE p.credito_id = cie.credito_id
             AND p.inversionista_id = cie.inversionista_id
           ORDER BY p.fecha_pago DESC, p.id DESC
           LIMIT 1
         ) AS ultimo_pago_espejo_id
  FROM ti
  LEFT JOIN cartera.usuarios u
    ON regexp_replace(unaccent(lower(trim(u.nombre))), '\s+', ' ', 'g') = regexp_replace(unaccent(lower(trim(ti.cliente))), '\s+', ' ', 'g')
  LEFT JOIN cartera.inversionistas i
    ON regexp_replace(unaccent(lower(trim(i.nombre))), '\s+', ' ', 'g') = regexp_replace(unaccent(lower(trim(ti.inv))), '\s+', ' ', 'g')
  LEFT JOIN cartera.creditos c ON c.usuario_id = u.usuario_id
  LEFT JOIN cartera.creditos_inversionistas_espejo cie
    ON cie.credito_id = c.credito_id AND cie.inversionista_id = i.inversionista_id
),
counts AS (
  SELECT ln, COUNT(*) FILTER (WHERE espejo_id IS NOT NULL) AS n_espejo
  FROM m GROUP BY ln
),
diag AS (
  SELECT m.ln, m.cliente_in, m.inv_in, m.monto_file,
         m.usuario_id, m.inversionista_id, m.credito_id, m.numero_credito_sifco,
         m.espejo_id, m.monto_actual,
         m.ultimo_pago_espejo_id, m.ultimo_abono_capital,
         (m.monto_file - COALESCE(m.ultimo_abono_capital, 0))::numeric(18,8) AS monto_nuevo,
         CASE
           WHEN m.usuario_id IS NULL THEN 'no_user'
           WHEN m.inversionista_id IS NULL THEN 'no_inv'
           WHEN co.n_espejo = 0 THEN 'no_espejo'
           WHEN co.n_espejo > 1 THEN 'ambiguo'
           WHEN m.ultimo_pago_espejo_id IS NULL THEN 'sin_pago'
           ELSE 'ok'
         END AS status
  FROM m
  JOIN counts co USING (ln)
)
"""

    diag_select = """
SELECT ln, status, cliente_in, inv_in, credito_id, numero_credito_sifco,
       espejo_id, monto_actual, monto_file, ultimo_abono_capital, monto_nuevo
FROM diag
ORDER BY ln;
"""

    summary_select = """
SELECT status, COUNT(DISTINCT ln) AS filas
FROM diag
GROUP BY status
ORDER BY status;
"""

    if mode == "dry-run":
        sql = f"""
CREATE EXTENSION IF NOT EXISTS unaccent;
{cte}
{diag_select}

{cte}
{summary_select}
"""
        subprocess.run(["psql", db_url, "-v", "ON_ERROR_STOP=1", "-c", sql], check=True)
        print()
        print("Dry-run completo. Para aplicar:")
        print("    python3 scripts/set-capital-inicial.py apply")
        return

    # apply
    # Líneas a saltar (deltas grandes / abonos corruptos — se manejan aparte).
    # Las 3 originales (21=Fredy, 42=Marines, 56=Werner) ya están corregidas
    # manualmente; ahora se aplican junto al resto.
    SKIP_LNS: tuple[int, ...] = ()
    skip_clause = (
        f"AND ln NOT IN ({','.join(str(x) for x in SKIP_LNS)})"
        if SKIP_LNS
        else ""
    )
    apply_sql = f"""
CREATE EXTENSION IF NOT EXISTS unaccent;
BEGIN;
{cte},
to_update AS (
  SELECT espejo_id, monto_nuevo
  FROM diag
  WHERE status = 'ok' {skip_clause}
)
UPDATE cartera.creditos_inversionistas_espejo cie
SET monto_aportado = tu.monto_nuevo
FROM to_update tu
WHERE cie.id = tu.espejo_id
RETURNING cie.id AS espejo_id, cie.credito_id, cie.inversionista_id,
          cie.monto_aportado AS monto_aportado_nuevo;

{cte}
SELECT ln, status, cliente_in, inv_in, credito_id, espejo_id, monto_actual,
       monto_file, ultimo_abono_capital, monto_nuevo
FROM diag
WHERE status <> 'ok'
ORDER BY ln;

COMMIT;
"""
    subprocess.run(["psql", db_url, "-v", "ON_ERROR_STOP=1", "-c", apply_sql], check=True)
    print()
    print("APPLY completo.")


if __name__ == "__main__":
    main()