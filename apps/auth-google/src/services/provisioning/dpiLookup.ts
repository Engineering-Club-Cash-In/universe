import { sql, type SQL } from "drizzle-orm";
import { users } from "../../db/schema";

/**
 * El SQL con el que se busca a alguien por DPI, aparte de `deps.ts`.
 *
 * Está en su propio módulo porque `deps.ts` abre la conexión a base y monta
 * Better Auth al importarse, así que no se puede cargar en una prueba. La
 * consecuencia de tenerlo allí adentro era concreta: se podía borrar el
 * `ORDER BY` entero —que es lo que decide cuál de dos personas con el mismo DPI
 * normalizado recibe el correo— y la suite entera seguía en verde.
 *
 * Aquí solo se arma el SQL; ejecutarlo sigue siendo trabajo de `deps.ts`.
 */

/**
 * Iguala el DPI guardado con el DPI buscado, normalizando LOS DOS LADOS.
 *
 * La normalización va en SQL y no en JS porque la columna trae basura de
 * captura ('1573 66197 01', '1852752810101.'): comparar el texto crudo no
 * encontraría a esas personas y el alta les crearía una cuenta que ya existe.
 *
 * Tiene que dar EXACTAMENTE la misma forma que `normalizarDpiPortal` de
 * `lib/provisioning.ts`, que es la que decide qué se GUARDA. Si los dos criterios
 * se separan, se guarda un valor que después no se encuentra, y a la misma
 * persona se le termina creando una segunda cuenta con una segunda contraseña.
 */
export const condicionDpiNormalizado = (dpiNormalizado: string): SQL =>
  sql`ltrim(regexp_replace(coalesce(${users.dpi}, ''), '[[:space:].-]', '', 'g'), '0') = ${dpiNormalizado}`;

/**
 * Desempata cuando la normalización empata a dos usuarios DISTINTOS.
 *
 * No es decorativo: hoy `1852752810101` lo tienen Oscar Massis (su DPI real) y
 * la cuenta de Inversiones Monaco (capturada con el DPI de su representante,
 * más un punto). Con `LIMIT 1` a secas, cuál de los dos sale lo decide el
 * planificador, y el aviso de "ahora representas a Monaco" podía terminar en la
 * bandeja de la propia empresa en vez de en la de Oscar.
 *
 * Gana la coincidencia EXACTA sobre la columna cruda —el dato limpio le gana al
 * sucio— y `created_at` desempata para que el resultado no cambie entre
 * corridas.
 */
export const ordenDesempateDpi = (dpiNormalizado: string): SQL =>
  sql`(${users.dpi} = ${dpiNormalizado}) DESC, ${users.createdAt} ASC`;

/** Iguala el correo sin distinguir mayúsculas: el login del portal no las distingue. */
export const condicionEmail = (emailEnMinusculas: string): SQL =>
  sql`lower(${users.email}) = ${emailEnMinusculas}`;
