import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Clock,
  History,
  Loader2,
  Pencil,
  PlusCircle,
  Power,
  Receipt,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/apiError";
import { creacionRubroBloqueada, estadoCreditoStyle } from "@/lib/estadoCredito";
import { fmtQ, sumaQ } from "@/lib/moneda";
import { fmtFechaGT, fmtFechaHoraGT } from "@/lib/fechaGT";
import {
  anularRubro,
  crearRubro,
  crearTipoRubro,
  editarRubro,
  editarTipoRubro,
  eliminarTipoRubro,
  getHistorialRubro,
  getRubrosByCredito,
  getTiposRubro,
  type EventoRubro,
  type RubroCredito,
  type TipoRubro,
} from "../services/rubros.services";

/**
 * Modal "Rubros" de un crédito.
 *
 * Rubros = cobros adicionales asociados al crédito (tarjeta de circulación,
 * calcomanía, …). Antes esto era una sección colapsable dentro de la fila
 * expandida de la lista de créditos; ahora es un modal que abre el botón
 * "Rubros" de la barra de acciones.
 *
 * Es UN SOLO `Dialog` con una vista interna por estado, no una pila de
 * diálogos: apilar modales de Radix deja focus traps anidados y overlays
 * encimados, y el usuario pierde de vista el crédito sobre el que está
 * trabajando. Cada vista que no es la lista trae su botón de volver.
 *
 * Permisos (el backend manda; esto solo evita viajes y opciones muertas):
 * ADMIN y ASESOR ven y crean; solo ADMIN usa tipos obligatorios, edita montos
 * y administra el catálogo de tipos (crear, editar, desactivar, eliminar).
 */

type Vista =
  | "lista"
  | "crear"
  | "editar"
  | "anular"
  | "historial"
  | "tipos"
  | "crearTipo"
  | "editarTipo";

/** Lo ya tipeado en "Agregar rubro", que sobrevive al desvío a los tipos. */
type BorradorRubro = { tipoId: string; monto: string; descripcion: string };

const BORRADOR_VACIO: BorradorRubro = { tipoId: "", monto: "", descripcion: "" };

/** Clave raíz de las queries de tipos; las variantes cuelgan de acá. */
const QK_TIPOS = "rubrosTipos";

const CLASE_SELECT =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500";

const CLASE_ERROR =
  "flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";

type EstadoRubro = {
  etiqueta: string;
  clase: string;
};

/**
 * Estado visible de un rubro. Completado manda sobre todo lo demás: si ya no
 * debe nada, da igual cómo quedó `activo`.
 *
 * Ya no existe "Esperando activación": sin `fecha_activacion` en el modelo, un
 * rubro nace vivo o apagado y no hay tercer estado que mostrar.
 */
function estadoDeRubro(r: RubroCredito): EstadoRubro {
  // Anulado va PRIMERO, antes que completado: anular deja el saldo en cero y por
  // tanto `completado` en true, así que preguntar por completado primero pintaba
  // "Completado" sobre un cargo que se canceló — en una pantalla de dinero eso
  // se lee como "ya se cobró", y no se cobró nada.
  if (r.anulado) {
    return { etiqueta: "Anulado", clase: "bg-red-100 text-red-800 border-red-200" };
  }
  if (r.completado) {
    return { etiqueta: "Completado", clase: "bg-green-100 text-green-800 border-green-200" };
  }
  if (!r.activo) {
    return { etiqueta: "Inactivo", clase: "bg-gray-100 text-gray-600 border-gray-200" };
  }
  return { etiqueta: "Activo", clase: "bg-blue-100 text-blue-800 border-blue-200" };
}

/**
 * Quién hizo un evento del historial. El nombre primero, pero el email es el
 * que casi siempre aparece: el nombre vive en `asesores` y las cuentas ADMIN no
 * tienen asesor ligado. "Sistema" queda para los eventos sin autor humano.
 */
const autorDe = (ev: EventoRubro): string =>
  ev.usuario_nombre ?? ev.usuario_email ?? "Sistema";

function ErrorEnLinea({ mensaje }: { mensaje: string }) {
  return (
    <p className={CLASE_ERROR}>
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      {mensaje}
    </p>
  );
}

function BotonVolver({ onClick, children = "Volver a la lista" }: {
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
      {children}
    </button>
  );
}

export default function RubrosCredito({
  open,
  onOpenChange,
  creditoId,
  statusCredit = null,
  rol = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditoId: number | null;
  /** `creditos."statusCredit"`; si no llega, no se gatea nada y manda el backend. */
  statusCredit?: string | null;
  /** `user.role`. ADMIN desbloquea tipos obligatorios, crear tipos y editar. */
  rol?: string | null;
}) {
  const queryClient = useQueryClient();
  const esAdmin = rol === "ADMIN";

  const [vista, setVista] = useState<Vista>("lista");
  const [rubroSel, setRubroSel] = useState<RubroCredito | null>(null);
  const [tipoSel, setTipoSel] = useState<TipoRubro | null>(null);
  /** A dónde vuelve "Crear tipo": se llega desde "crear" y desde "tipos". */
  const [origenCrearTipo, setOrigenCrearTipo] = useState<"crear" | "tipos">("crear");
  /**
   * El formulario de "Agregar rubro" vive acá y no adentro de `VistaCrear`
   * porque ir a crear/administrar tipos desmonta esa vista: si el estado
   * fuera suyo, el monto y la descripción ya tipeados se perderían en el
   * desvío, que es justo el momento en que el usuario los tiene escritos.
   */
  const [borrador, setBorrador] = useState<BorradorRubro>(BORRADOR_VACIO);

  /**
   * `creditoId` que la UI muestra. `open` y `creditoId` salen del mismo estado
   * en el llamador (`!!rubrosCredito` / `rubrosCredito?.credito_id`), así que al
   * cerrar los dos cambian en el mismo commit y el crédito se vuelve null
   * mientras el diálogo todavía está corriendo su animación de salida. Con el
   * último valor no nulo retenido, esos ~200ms siguen mostrando el contenido de
   * siempre en vez de un cartel de error.
   */
  const [creditoVisible, setCreditoVisible] = useState<number | null>(creditoId);
  useEffect(() => {
    if (creditoId !== null) setCreditoVisible(creditoId);
  }, [creditoId]);

  // Cada apertura empieza en la lista: si el modal recordara la última vista,
  // reabrirlo en otro crédito caería en un formulario de edición ajeno.
  useEffect(() => {
    if (!open) return;
    setVista("lista");
    setRubroSel(null);
    setTipoSel(null);
    setBorrador(BORRADOR_VACIO);
  }, [open, creditoId]);

  const rubrosQuery = useQuery({
    queryKey: ["rubrosCredito", creditoVisible],
    queryFn: () => getRubrosByCredito(creditoVisible!),
    enabled: open && !!creditoVisible,
  });

  const rubros = useMemo(() => rubrosQuery.data ?? [], [rubrosQuery.data]);

  /**
   * Sólo los rubros VIVOS: un rubro desactivado conserva su `saldo_pendiente`
   * en la base —desactivarlo es dejar de cobrarlo, no ponerlo en cero— y
   * sumarlo hacía que el encabezado anunciara plata que nadie va a cobrar.
   * `completado` ya trae saldo 0, pero se excluye igual para que el total diga
   * exactamente "lo que queda por cobrar" y no dependa de esa coincidencia.
   */
  const totalPendiente = useMemo(
    () =>
      sumaQ(
        rubros.filter((r) => r.activo && !r.completado).map((r) => r.saldo_pendiente)
      ),
    [rubros]
  );

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: ["rubrosCredito", creditoVisible] });

  // Gate SOLO de creación: la lista y el historial se siguen viendo (es el
  // registro de lo que ya se le cobró al cliente) y la edición tampoco se toca
  // —el backend la permite y puede hacer falta corregir un monto ya cobrado—.
  //
  // El motivo viene armado porque no hay un solo bloqueo: el estado terminal no
  // lo levanta nadie, mientras que MOROSO/EN_CONVENIO sólo bloquean a quien no
  // es ADMIN (a él le quedan los tipos obligatorios).
  const motivoBloqueo = creacionRubroBloqueada(statusCredit, rol);

  const volver = () => {
    setVista("lista");
    setRubroSel(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Ancho: la tabla de la lista trae 8 columnas y con `max-w-5xl` el
        `sm:max-w-lg` de la base ganaba en pantallas grandes (distinto
        breakpoint ⇒ `tailwind-merge` no lo pisa), así que el modal se quedaba
        en 32rem y la tabla scrolleaba con 4 columnas a la vista. Se pisa el
        `sm:` explícitamente con un ancho fluido topado: en escritorio da aire
        de sobra y en pantallas chicas sigue siendo un margen de 95vw.
      */}
      <DialogContent className="bg-white max-w-[calc(100%-1.5rem)] sm:max-w-[min(95vw,1400px)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-purple-700">
            <Receipt className="w-5 h-5 shrink-0" />
            Rubros — Crédito #{creditoVisible ?? "--"}
            {statusCredit && (
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${estadoCreditoStyle(
                  statusCredit
                )}`}
              >
                {statusCredit}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-gray-600">
            Cobros adicionales asociados al crédito. Se listan todos, incluidos
            los completados e inactivos.
          </DialogDescription>
        </DialogHeader>

        {/*
          El aviso de abajo decía que "el crédito todavía no tiene pagos
          cargados": era falso —`creditoId` sale de `item.creditos.credito_id`,
          nada que ver con los pagos— y además se veía al cerrar el modal. Con
          el id retenido este caso solo ocurre si el llamador abre sin crédito,
          y el texto dice exactamente eso.
        */}
        {!creditoVisible ? (
          <div className="flex items-center gap-2 rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
            <Receipt className="w-4 h-4 shrink-0" />
            No se pudo identificar el crédito, así que no hay rubros que mostrar.
          </div>
        ) : vista === "lista" ? (
          <VistaLista
            rubros={rubros}
            totalPendiente={totalPendiente}
            cargando={rubrosQuery.isLoading}
            error={rubrosQuery.isError ? rubrosQuery.error : null}
            onReintentar={() => rubrosQuery.refetch()}
            esAdmin={esAdmin}
            motivoBloqueo={motivoBloqueo}
            onAgregar={() => {
              setBorrador(BORRADOR_VACIO);
              setVista("crear");
            }}
            onEditar={(r) => {
              setRubroSel(r);
              setVista("editar");
            }}
            onAnular={(r) => {
              setRubroSel(r);
              setVista("anular");
            }}
            onHistorial={(r) => {
              setRubroSel(r);
              setVista("historial");
            }}
          />
        ) : vista === "crear" ? (
          <VistaCrear
            creditoId={creditoVisible}
            esAdmin={esAdmin}
            borrador={borrador}
            setBorrador={setBorrador}
            onVolver={volver}
            onCrearTipo={() => {
              setOrigenCrearTipo("crear");
              setVista("crearTipo");
            }}
            onAdministrarTipos={() => setVista("tipos")}
            onCreado={() => {
              invalidar();
              setBorrador(BORRADOR_VACIO);
              volver();
            }}
          />
        ) : vista === "anular" && esAdmin && rubroSel ? (
          // Una vista más del mismo Dialog, igual que "editar": anular pide un
          // motivo y una explicación de qué le pasa al rubro, que no entran en
          // una confirmación de fila, y apilar un segundo Dialog es justo lo que
          // este componente evita.
          <VistaAnular
            key={rubroSel.rubro_id}
            rubro={rubroSel}
            onVolver={volver}
            onAnulado={() => {
              invalidar();
              volver();
            }}
          />
        ) : vista === "editar" && rubroSel ? (
          // `key` por rubro: los campos de `VistaEditar` se inicializan desde
          // las props, así que sin remontar, cambiar de rubro con la vista ya
          // montada dejaría el monto y la descripción del rubro ANTERIOR en el
          // formulario — y el PUT guardaría un monto sobre otro rubro. Hoy sólo
          // lo evita que el único camino a "editar" pase por la lista; eso es un
          // invariante frágil, no una garantía.
          <VistaEditar
            key={rubroSel.rubro_id}
            rubro={rubroSel}
            onVolver={volver}
            onEditado={() => {
              invalidar();
              volver();
            }}
          />
        ) : vista === "historial" && rubroSel ? (
          <VistaHistorial rubro={rubroSel} onVolver={volver} />
        ) : vista === "tipos" && esAdmin ? (
          <VistaAdminTipos
            onVolver={() => setVista("crear")}
            onCrearTipo={() => {
              setOrigenCrearTipo("tipos");
              setVista("crearTipo");
            }}
            onEditar={(t) => {
              setTipoSel(t);
              setVista("editarTipo");
            }}
          />
        ) : vista === "editarTipo" && esAdmin && tipoSel ? (
          <VistaEditarTipo
            tipo={tipoSel}
            onVolver={() => setVista("tipos")}
            onGuardado={() => setVista("tipos")}
          />
        ) : vista === "crearTipo" && esAdmin ? (
          <VistaCrearTipo
            volverA={origenCrearTipo}
            onVolver={() => setVista(origenCrearTipo)}
            onCreado={(tipo) => {
              // Viniendo de "crear rubro", el tipo recién hecho queda
              // seleccionado; viniendo de la administración, se vuelve al
              // listado para verlo ahí.
              if (origenCrearTipo === "crear") {
                setBorrador((b) => ({ ...b, tipoId: String(tipo.tipo_id) }));
                setVista("crear");
              } else {
                setVista("tipos");
              }
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Lista --- */

function VistaLista({
  rubros,
  totalPendiente,
  cargando,
  error,
  onReintentar,
  esAdmin,
  motivoBloqueo,
  onAgregar,
  onEditar,
  onAnular,
  onHistorial,
}: {
  rubros: RubroCredito[];
  totalPendiente: number;
  cargando: boolean;
  error: unknown;
  onReintentar: () => void;
  esAdmin: boolean;
  /** Por qué no se puede crear un rubro, o `null` si sí se puede. */
  motivoBloqueo: string | null;
  onAgregar: () => void;
  onEditar: (r: RubroCredito) => void;
  onAnular: (r: RubroCredito) => void;
  onHistorial: (r: RubroCredito) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-purple-700">
          {rubros.length} rubro{rubros.length === 1 ? "" : "s"} · pendiente{" "}
          <span className="tabular-nums">{fmtQ(totalPendiente)}</span>
        </span>
        <Button
          onClick={onAgregar}
          disabled={motivoBloqueo !== null}
          className="bg-purple-600 hover:bg-purple-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusCircle className="w-4 h-4 mr-2" />
          Agregar rubro
        </Button>
      </div>

      {motivoBloqueo && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {motivoBloqueo}
        </p>
      )}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-purple-600 font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" />
          Cargando rubros...
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="flex items-center gap-2 text-red-600 font-semibold text-center">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {getApiErrorMessage(error, "No se pudieron cargar los rubros")}
          </p>
          <Button variant="outline" onClick={onReintentar}>
            Reintentar
          </Button>
        </div>
      ) : rubros.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 py-10 text-center">
          <Receipt className="w-6 h-6 text-gray-400" />
          <p className="font-semibold text-gray-700">
            Este crédito no tiene rubros registrados.
          </p>
          <p className="text-sm text-gray-500">
            Usá “Agregar rubro” para registrar un cobro adicional.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-purple-50">
                <TableHead className="text-purple-900 font-bold">Tipo</TableHead>
                <TableHead className="text-purple-900 font-bold">Descripción</TableHead>
                <TableHead className="text-purple-900 font-bold text-right">Monto</TableHead>
                <TableHead className="text-purple-900 font-bold text-right">Abonado</TableHead>
                <TableHead className="text-purple-900 font-bold text-right">Saldo</TableHead>
                <TableHead className="text-purple-900 font-bold">Estado</TableHead>
                <TableHead className="text-purple-900 font-bold">Creado</TableHead>
                <TableHead className="text-purple-900 font-bold text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rubros.map((r) => {
                const estado = estadoDeRubro(r);
                const saldo = Number(r.saldo_pendiente ?? 0);
                const vivo = saldo > 0;
                return (
                  <TableRow
                    key={r.rubro_id}
                    className={vivo ? "bg-white" : "bg-gray-50/70 text-gray-500"}
                  >
                    <TableCell className="font-semibold text-gray-900">
                      {r.tipo_nombre}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {r.descripcion || "--"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtQ(r.monto_original)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-700">
                      {fmtQ(r.abonado)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-bold ${
                        vivo ? "text-red-600" : "text-green-700"
                      }`}
                    >
                      {fmtQ(saldo)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${estado.clase}`}
                      >
                        {estado.etiqueta}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-700 whitespace-nowrap">
                      {fmtFechaGT(r.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {/*
                          Editar no sobre un rubro ANULADO: anular es la salida
                          irreversible de un cargo que se dio de baja a
                          propósito, y el backend lo está cerrando por su lado
                          (aparte de esta pantalla). Se OCULTA en vez de
                          deshabilitarse, igual que "Anular" más abajo sobre su
                          propio criterio: un botón apagado en una fila
                          terminal no tiene nada que ofrecer. Completado SÍ
                          sigue editable a propósito (puede hacer falta
                          corregir un monto ya cobrado), así que el gate es
                          `!r.anulado` y no `!r.completado`.
                        */}
                        {esAdmin && !r.anulado && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
                            onClick={() => onEditar(r)}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1" />
                            Editar
                          </Button>
                        )}
                        {/*
                          Anular solo sobre lo que el backend todavía acepta:
                          un rubro anulado queda `completado`, igual que uno ya
                          cobrado, así que `!completado` es exactamente el
                          conjunto que no responde 409. Sobre el resto no se
                          muestra en vez de mostrarse apagado: un botón
                          deshabilitado en una fila terminal no tiene nada que
                          ofrecer.
                        */}
                        {esAdmin && !r.completado && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-red-600 hover:bg-red-700 text-white border-red-600"
                            onClick={() => onAnular(r)}
                          >
                            <Ban className="w-3.5 h-3.5 mr-1" />
                            Anular
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-gray-600 hover:bg-gray-700 text-white border-gray-600"
                          onClick={() => onHistorial(r)}
                        >
                          <History className="w-3.5 h-3.5 mr-1" />
                          Historial
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Crear --- */

function VistaCrear({
  creditoId,
  esAdmin,
  borrador,
  setBorrador,
  onVolver,
  onCrearTipo,
  onAdministrarTipos,
  onCreado,
}: {
  creditoId: number;
  esAdmin: boolean;
  borrador: BorradorRubro;
  setBorrador: React.Dispatch<React.SetStateAction<BorradorRubro>>;
  onVolver: () => void;
  onCrearTipo: () => void;
  onAdministrarTipos: () => void;
  onCreado: () => void;
}) {
  const { tipoId, monto, descripcion } = borrador;
  const campo = (k: keyof BorradorRubro) => (v: string) =>
    setBorrador((b) => ({ ...b, [k]: v }));
  const [error, setError] = useState<string | null>(null);

  // Solo los ACTIVOS: este desplegable es para cobrar, y un tipo desactivado
  // se desactivó justamente para dejar de ofrecerlo. Los inactivos se ven en
  // la vista de administración, que pide la lista completa.
  const tiposQuery = useQuery({
    queryKey: [QK_TIPOS, false],
    queryFn: () => getTiposRubro(false),
  });

  // Un asesor no puede usar tipos obligatorios: el backend responde 403, así
  // que ni siquiera se los ofrecemos en el desplegable.
  const tipos = useMemo(() => {
    const todos = tiposQuery.data ?? [];
    return esAdmin ? todos : todos.filter((t) => !t.obligatorio);
  }, [tiposQuery.data, esAdmin]);

  const tipoElegido = tipos.find((t) => String(t.tipo_id) === tipoId) ?? null;

  // El borrador sobrevive al desvío a "Administrar tipos", donde el tipo
  // elegido puede haber quedado desactivado o borrado. Si ya no está entre los
  // ofrecidos, se suelta la selección en vez de mandar un id muerto al backend.
  useEffect(() => {
    if (!tipoId || tiposQuery.isLoading || tiposQuery.isError) return;
    if (!tipoElegido) setBorrador((b) => ({ ...b, tipoId: "" }));
  }, [tipoId, tipoElegido, tiposQuery.isLoading, tiposQuery.isError, setBorrador]);

  const crear = useMutation({
    mutationFn: () =>
      crearRubro({
        credito_id: creditoId,
        tipo_id: Number(tipoId),
        monto: Number(monto),
        descripcion: descripcion.trim(),
      }),
    onSuccess: () => {
      toast.success("Rubro creado");
      onCreado();
    },
    onError: (e) => {
      // 403 = el asesor intentó un tipo obligatorio. 409 = regla de negocio
      // (crédito en mora, estado terminal, rubro duplicado). En los dos casos
      // el `message` del backend se muestra tal cual y se queda en pantalla:
      // un toast se iría mientras el usuario lo está leyendo.
      setError(getApiErrorMessage(e, "No se pudo crear el rubro"));
    },
  });

  const submit = () => {
    setError(null);
    if (!tipoId) return setError("Selecciona el tipo de rubro");
    const montoNum = Number(monto);
    if (!monto.trim() || !Number.isFinite(montoNum) || montoNum <= 0) {
      return setError("El monto debe ser un número mayor a cero");
    }
    if (!descripcion.trim()) return setError("La descripción es obligatoria");
    crear.mutate();
  };

  return (
    <div className="flex flex-col gap-3 text-gray-800">
      <BotonVolver onClick={onVolver} />

      <h3 className="flex items-center gap-2 font-bold text-purple-700">
        <PlusCircle className="w-5 h-5" />
        Agregar rubro
      </h3>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2 flex-wrap">
          <Label>Tipo de rubro</Label>
          {esAdmin && (
            <span className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCrearTipo}
                className="text-xs font-semibold text-purple-700 hover:underline"
              >
                + Crear tipo nuevo
              </button>
              <button
                type="button"
                onClick={onAdministrarTipos}
                className="flex items-center gap-1 text-xs font-semibold text-gray-600 hover:underline"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Administrar tipos
              </button>
            </span>
          )}
        </div>
        {tiposQuery.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando tipos...
          </p>
        ) : tiposQuery.isError ? (
          <p className="text-sm text-red-600">
            {getApiErrorMessage(tiposQuery.error, "No se pudieron cargar los tipos de rubro")}
          </p>
        ) : tipos.length === 0 ? (
          <p className="text-sm text-amber-700">
            {esAdmin
              ? "No hay tipos de rubro activos configurados."
              : "No hay tipos de rubro opcionales disponibles. Los obligatorios solo los puede cobrar un administrador."}
          </p>
        ) : (
          <>
            <select
              className={CLASE_SELECT}
              value={tipoId}
              onChange={(e) => campo("tipoId")(e.target.value)}
            >
              <option value="">Selecciona un tipo</option>
              {tipos.map((t) => (
                <option key={t.tipo_id} value={t.tipo_id}>
                  {t.nombre}
                </option>
              ))}
            </select>
            {/* Obligatorio vs opcional decide si el cobro se puede registrar con
                el crédito en mora, así que se dice explícito y no se deduce. */}
            {tipoElegido && (
              <p
                className={`mt-1 text-xs font-medium ${
                  tipoElegido.obligatorio ? "text-red-700" : "text-gray-500"
                }`}
              >
                {tipoElegido.obligatorio
                  ? "Tipo obligatorio: se puede cobrar aunque el crédito esté en mora."
                  : "Tipo opcional: no se puede cobrar si el crédito está en mora."}
              </p>
            )}
          </>
        )}
      </div>

      <div>
        <Label htmlFor="rubro-monto" className="mb-1 block">
          Monto
        </Label>
        <Input
          id="rubro-monto"
          type="number"
          min="0"
          step="0.01"
          value={monto}
          onChange={(e) => campo("monto")(e.target.value)}
          placeholder="0.00"
        />
      </div>

      <div>
        <Label htmlFor="rubro-desc" className="mb-1 block">
          Descripción
        </Label>
        <Input
          id="rubro-desc"
          value={descripcion}
          onChange={(e) => campo("descripcion")(e.target.value)}
          placeholder="Ej: Tarjeta de circulación 2026"
        />
      </div>

      {error && <ErrorEnLinea mensaje={error} />}

      <DialogFooter className="gap-2">
        <Button
          variant="outline"
          className="bg-gray-600 hover:bg-gray-700 text-white font-semibold border-gray-600"
          disabled={crear.isPending}
          onClick={onVolver}
        >
          Cancelar
        </Button>
        <Button
          onClick={submit}
          className="bg-purple-600 hover:bg-purple-700 text-white"
          disabled={crear.isPending}
        >
          {crear.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Crear rubro
        </Button>
      </DialogFooter>
    </div>
  );
}

/* --------------------------------------------------------------- Editar --- */

function VistaEditar({
  rubro,
  onVolver,
  onEditado,
}: {
  rubro: RubroCredito;
  onVolver: () => void;
  onEditado: () => void;
}) {
  const [monto, setMonto] = useState(String(rubro.monto_original ?? ""));
  const [descripcion, setDescripcion] = useState(rubro.descripcion ?? "");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  // El motivo es obligatorio SIEMPRE, cambie o no el monto: es lo que el
  // backend exige ahora y lo que hace legible el historial. Acá vivía un
  // `montoCambio` que comparaba floats crudos contra el monto original
  // mientras el backend comparaba el redondeado con `Big`: para diferencias de
  // sub-centavo los dos lados no coincidían y el formulario dejaba pasar un
  // guardado que el backend rechazaba. Sin esa deducción no hay discrepancia.

  const editar = useMutation({
    mutationFn: () =>
      editarRubro(rubro.rubro_id, {
        monto: Number(monto),
        descripcion: descripcion.trim(),
        motivo: motivo.trim(),
      }),
    onSuccess: () => {
      toast.success("Rubro actualizado");
      onEditado();
    },
    onError: (e) => {
      // 409 = regla de negocio ("el monto no puede ser menor a lo ya abonado").
      setError(getApiErrorMessage(e, "No se pudo editar el rubro"));
    },
  });

  const submit = () => {
    setError(null);
    const montoNum = Number(monto);
    if (!String(monto).trim() || !Number.isFinite(montoNum) || montoNum <= 0) {
      return setError("El monto debe ser un número mayor a cero");
    }
    if (!descripcion.trim()) return setError("La descripción es obligatoria");
    if (!motivo.trim()) {
      return setError("El motivo es obligatorio: queda en el historial del rubro");
    }
    editar.mutate();
  };

  return (
    <div className="flex flex-col gap-3 text-gray-800">
      <BotonVolver onClick={onVolver} />

      <div>
        <h3 className="flex items-center gap-2 font-bold text-blue-700">
          <Pencil className="w-5 h-5" />
          Editar rubro
        </h3>
        <p className="text-sm text-gray-600">
          {rubro.tipo_nombre} · abonado{" "}
          <b className="tabular-nums">{fmtQ(rubro.abonado)}</b> · saldo{" "}
          <b className="tabular-nums">{fmtQ(rubro.saldo_pendiente)}</b>
        </p>
      </div>

      <div>
        <Label htmlFor="edit-monto" className="mb-1 block">
          Monto
        </Label>
        <Input
          id="edit-monto"
          type="number"
          min="0"
          step="0.01"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="edit-desc" className="mb-1 block">
          Descripción
        </Label>
        <Input
          id="edit-desc"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="edit-motivo" className="mb-1 block">
          Motivo <span className="text-red-600" aria-hidden="true">*</span>
        </Label>
        <Input
          id="edit-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          required
          aria-required="true"
          placeholder="Ej: Corrección del monto acordado con el cliente"
        />
        <p className="mt-1 text-xs text-gray-500">
          Obligatorio. Queda registrado en el historial del rubro.
        </p>
      </div>

      {error && <ErrorEnLinea mensaje={error} />}

      <DialogFooter className="gap-2">
        <Button
          variant="outline"
          className="bg-gray-600 hover:bg-gray-700 text-white font-semibold border-gray-600"
          disabled={editar.isPending}
          onClick={onVolver}
        >
          Cancelar
        </Button>
        {/*
          Deshabilitado sin motivo: el texto de ayuda del campo, justo arriba,
          ya dice por qué, así que el botón apagado no queda mudo.
        */}
        <Button
          onClick={submit}
          className="bg-blue-600 hover:bg-blue-700 text-white"
          disabled={editar.isPending || !motivo.trim()}
        >
          {editar.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Guardar cambios
        </Button>
      </DialogFooter>
    </div>
  );
}

/* --------------------------------------------------------------- Anular --- */

/**
 * Anular un rubro creado por error.
 *
 * Es la única salida real: un rubro no se puede borrar (se llevaría el
 * historial de cobros) ni editar a cero (la política de montos lo rechaza), y
 * mientras siga vivo el índice único impide crear el rubro correcto de ese
 * mismo tipo. Sin esta pantalla el arreglo era SQL a mano en producción.
 *
 * Como es irreversible, la vista dice antes de ejecutar qué queda después:
 * deja de cobrarse, NO se borra —el monto original sigue ahí y la anulación
 * queda asentada con su motivo— y recién entonces se puede crear el rubro
 * correcto del mismo tipo. El motivo es obligatorio (el backend responde 400
 * si viene en blanco) y el botón está apagado hasta que haya uno.
 */
function VistaAnular({
  rubro,
  onVolver,
  onAnulado,
}: {
  rubro: RubroCredito;
  onVolver: () => void;
  onAnulado: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const anular = useMutation({
    mutationFn: () => anularRubro(rubro.rubro_id, { motivo: motivo.trim() }),
    onSuccess: () => {
      toast.success("Rubro anulado");
      onAnulado();
    },
    onError: (e) => {
      // 403 = no es ADMIN. 409 = el rubro ya estaba anulado o completado (dos
      // pestañas, o alguien lo anuló mientras esta vista estaba abierta). Los
      // dos traen un `message` redactado y se muestra tal cual, acá mismo: un
      // toast se iría mientras el usuario lo está leyendo, y ésta es la única
      // acción del modal que no se puede deshacer.
      setError(getApiErrorMessage(e, "No se pudo anular el rubro"));
    },
  });

  const submit = () => {
    setError(null);
    if (!motivo.trim()) {
      return setError("El motivo es obligatorio: queda en el historial del rubro");
    }
    anular.mutate();
  };

  return (
    <div className="flex flex-col gap-3 text-gray-800">
      <BotonVolver onClick={onVolver} />

      <div>
        <h3 className="flex items-center gap-2 font-bold text-red-700">
          <Ban className="w-5 h-5" />
          Anular rubro
        </h3>
        <p className="text-sm text-gray-600">
          {rubro.tipo_nombre}
          {rubro.descripcion ? ` · ${rubro.descripcion}` : ""} · monto{" "}
          <b className="tabular-nums">{fmtQ(rubro.monto_original)}</b> · abonado{" "}
          <b className="tabular-nums">{fmtQ(rubro.abonado)}</b> · saldo{" "}
          <b className="tabular-nums">{fmtQ(rubro.saldo_pendiente)}</b>
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <p className="flex items-start gap-2 font-semibold">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Anular es irreversible: no hay cómo revertirlo desde el sistema.
        </p>
        <ul className="list-disc pl-9 space-y-1">
          <li>
            El saldo de{" "}
            <b className="tabular-nums">{fmtQ(rubro.saldo_pendiente)}</b> queda en
            cero y el rubro <b>deja de cobrarse</b>.
          </li>
          <li>
            El rubro <b>no se borra</b>: sigue en la lista y en el historial con
            su monto original de{" "}
            <b className="tabular-nums">{fmtQ(rubro.monto_original)}</b>, y la
            anulación queda asentada con tu motivo.
          </li>
          <li>
            Después de anularlo vas a poder <b>crear otro rubro del mismo tipo</b>
            {" "}para este crédito.
          </li>
        </ul>
      </div>

      <div>
        <Label htmlFor="anular-motivo" className="mb-1 block">
          Motivo <span className="text-red-600" aria-hidden="true">*</span>
        </Label>
        <Input
          id="anular-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          required
          aria-required="true"
          placeholder="Ej: Se cargó por error, el tipo correcto era calcomanía"
        />
        <p className="mt-1 text-xs text-gray-500">
          Obligatorio. Es lo único que después explica por qué este cobro se dio
          de baja.
        </p>
      </div>

      {error && <ErrorEnLinea mensaje={error} />}

      <DialogFooter className="gap-2">
        <Button
          variant="outline"
          className="bg-gray-600 hover:bg-gray-700 text-white font-semibold border-gray-600"
          disabled={anular.isPending}
          onClick={onVolver}
        >
          Cancelar
        </Button>
        <Button
          onClick={submit}
          className="bg-red-600 hover:bg-red-700 text-white"
          disabled={anular.isPending || !motivo.trim()}
        >
          {anular.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Anular rubro
        </Button>
      </DialogFooter>
    </div>
  );
}

/* ----------------------------------------------------------- Crear tipo --- */

function VistaCrearTipo({
  volverA,
  onVolver,
  onCreado,
}: {
  /** Desde dónde se llegó; solo cambia el texto del botón de volver. */
  volverA: "crear" | "tipos";
  onVolver: () => void;
  onCreado: (tipo: TipoRubro) => void;
}) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [obligatorio, setObligatorio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = useMutation({
    mutationFn: () =>
      crearTipoRubro({
        nombre: nombre.trim(),
        ...(descripcion.trim() ? { descripcion: descripcion.trim() } : {}),
        obligatorio,
      }),
    onSuccess: (tipo) => {
      toast.success("Tipo de rubro creado");
      // `invalidateQueries` NO alcanza acá: marca la query como obsoleta pero
      // sólo la vuelve a pedir si está MONTADA en ese momento. El desplegable
      // de "crear" y el listado de administración pueden estar desmontados en
      // el instante del POST (por ejemplo, viniendo de "tipos"), así que
      // esperar el `invalidateQueries` no garantiza tener el tipo nuevo en
      // caché al volver — hay que sembrarlo a mano con lo que devolvió el
      // propio POST. El backend siempre crea el tipo activo (no hay forma de
      // pedirlo inactivo), así que entra en las dos variantes de la query: la
      // que sólo trae activos (el desplegable de "crear") y la que trae todo
      // (la administración de tipos). El orden replica el `ORDER BY nombre`
      // del backend para no desordenar la lista.
      const insertarOrdenado = (actuales: TipoRubro[] | undefined) => {
        const lista = actuales ? [...actuales] : [];
        if (lista.some((t) => t.tipo_id === tipo.tipo_id)) return lista;
        const idx = lista.findIndex((t) => t.nombre.localeCompare(tipo.nombre) > 0);
        if (idx === -1) lista.push(tipo);
        else lista.splice(idx, 0, tipo);
        return lista;
      };
      queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, false], insertarOrdenado);
      queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, true], insertarOrdenado);
      // Se deja además por si hay otra pestaña/instancia con la query inactiva
      // en memoria: no es de lo que depende esta pantalla, pero sirve para
      // refrescar a los demás.
      queryClient.invalidateQueries({ queryKey: [QK_TIPOS] });
      onCreado(tipo);
    },
    onError: (e) => {
      setError(getApiErrorMessage(e, "No se pudo crear el tipo de rubro"));
    },
  });

  const submit = () => {
    setError(null);
    if (!nombre.trim()) return setError("El nombre del tipo es obligatorio");
    crear.mutate();
  };

  return (
    <div className="flex flex-col gap-3 text-gray-800">
      <BotonVolver onClick={onVolver}>
        {volverA === "crear" ? "Volver a agregar rubro" : "Volver a los tipos"}
      </BotonVolver>

      <h3 className="flex items-center gap-2 font-bold text-purple-700">
        <PlusCircle className="w-5 h-5" />
        Crear tipo de rubro
      </h3>

      <div>
        <Label htmlFor="tipo-nombre" className="mb-1 block">
          Nombre
        </Label>
        <Input
          id="tipo-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Tarjeta de circulación"
        />
      </div>

      <div>
        <Label htmlFor="tipo-desc" className="mb-1 block">
          Descripción <span className="text-gray-400 font-normal">(opcional)</span>
        </Label>
        <Input
          id="tipo-desc"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 accent-purple-600"
          checked={obligatorio}
          onChange={(e) => setObligatorio(e.target.checked)}
        />
        Obligatorio
      </label>
      <p className="-mt-1 text-xs text-gray-500">
        Un tipo obligatorio se puede cobrar aunque el crédito esté en mora, y
        solo lo puede usar un administrador.
      </p>

      {error && <ErrorEnLinea mensaje={error} />}

      <DialogFooter className="gap-2">
        <Button
          variant="outline"
          className="bg-gray-600 hover:bg-gray-700 text-white font-semibold border-gray-600"
          disabled={crear.isPending}
          onClick={onVolver}
        >
          Cancelar
        </Button>
        <Button
          onClick={submit}
          className="bg-purple-600 hover:bg-purple-700 text-white"
          disabled={crear.isPending}
        >
          {crear.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Crear tipo
        </Button>
      </DialogFooter>
    </div>
  );
}

/* --------------------------------------------------- Administrar tipos --- */

/**
 * Catálogo de tipos de rubro: editar, desactivar/reactivar y borrar. Solo
 * ADMIN, y solo se llega desde "Agregar rubro", que es donde el usuario nota
 * que al catálogo le falta o le sobra algo.
 *
 * Acá se piden los INACTIVOS también (`getTiposRubro(true)`): administrar un
 * catálogo sin ver lo que está apagado deja tipos irrecuperables desde la UI.
 * El desplegable de creación sigue pidiendo solo los activos.
 *
 * Borrar vs desactivar: el backend borra de verdad solo si el tipo no tiene
 * rubros, y si los tiene responde 409 —arrastrar el borrado se llevaría el
 * historial de esos cobros—. Ese 409 no es un error a tapar sino la respuesta
 * útil: se muestra el mensaje del backend y se ofrece desactivar, que consigue
 * lo que el usuario realmente quería (dejar de ofrecerlo) sin perder nada.
 */
function VistaAdminTipos({
  onVolver,
  onCrearTipo,
  onEditar,
}: {
  onVolver: () => void;
  onCrearTipo: () => void;
  onEditar: (tipo: TipoRubro) => void;
}) {
  const queryClient = useQueryClient();
  /** Tipo con el borrado pedido y todavía sin confirmar. */
  const [confirmando, setConfirmando] = useState<number | null>(null);
  /**
   * 409 del backend: el tipo tiene rubros. Se guarda por tipo junto con su
   * mensaje para ofrecer el desactivar ahí mismo, en la fila.
   */
  const [bloqueado, setBloqueado] = useState<{ tipoId: number; mensaje: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  /** Tipo sobre el que corre una mutación, para apagar solo esa fila. */
  const [ocupado, setOcupado] = useState<number | null>(null);

  const tiposQuery = useQuery({
    queryKey: [QK_TIPOS, true],
    queryFn: () => getTiposRubro(true),
  });

  const tipos = tiposQuery.data ?? [];

  const refrescar = () =>
    queryClient.invalidateQueries({ queryKey: [QK_TIPOS] });

  const eliminar = useMutation({
    mutationFn: (tipoId: number) => eliminarTipoRubro(tipoId),
    onSuccess: async (_d, tipoId) => {
      toast.success("Tipo de rubro eliminado");
      setConfirmando(null);
      setBloqueado((b) => (b?.tipoId === tipoId ? null : b));
      // Mismo defecto que al crear un tipo (ver VistaCrearTipo): esta vista
      // está montada con [QK_TIPOS, true] y se refresca sola con el
      // `invalidateQueries` de abajo, pero el desplegable de "crear" —con
      // [QK_TIPOS, false]— puede estar desmontado y quedarse con el tipo ya
      // borrado. Se saca a mano de las dos variantes.
      const sacar = (actuales: TipoRubro[] | undefined) =>
        actuales?.filter((t) => t.tipo_id !== tipoId);
      queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, false], sacar);
      queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, true], sacar);
      await refrescar();
    },
    onError: (e, tipoId) => {
      const mensaje = getApiErrorMessage(e, "No se pudo eliminar el tipo de rubro");
      const status = (e as { response?: { status?: number } })?.response?.status;
      setConfirmando(null);
      if (status === 409) {
        // Tiene rubros: el camino correcto es desactivarlo, no borrarlo.
        setBloqueado({ tipoId, mensaje });
        setError(null);
      } else {
        setError(mensaje);
      }
    },
    onSettled: () => setOcupado(null),
  });

  const cambiarActivo = useMutation({
    mutationFn: ({ tipoId, activo }: { tipoId: number; activo: boolean }) =>
      editarTipoRubro(tipoId, { activo }),
    onSuccess: async (_d, { tipoId, activo }) => {
      toast.success(activo ? "Tipo reactivado" : "Tipo desactivado");
      setBloqueado((b) => (b?.tipoId === tipoId ? null : b));
      setError(null);
      // Misma corrección que en `eliminar`: [QK_TIPOS, true] se refresca solo
      // por estar montada acá, pero [QK_TIPOS, false] —el desplegable de
      // "crear"— puede quedar desmontada y con el tipo desactivado como si
      // siguiera ofrecible. Se actualizan las dos a mano con lo que ya
      // sabemos de la mutación (no hace falta lo que devuelve el backend,
      // que es `void`).
      queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, true], (actuales) =>
        actuales?.map((t) => (t.tipo_id === tipoId ? { ...t, activo } : t))
      );
      queryClient.setQueryData<TipoRubro[]>([QK_TIPOS, false], (actuales) => {
        if (!actuales) return actuales;
        if (!activo) return actuales.filter((t) => t.tipo_id !== tipoId);
        // Reactivar: el tipo ya no está en la lista de solo-activos (se sacó
        // al desactivarlo), así que se reinserta ordenado por nombre igual
        // que al crear. Se toma el objeto completo de `tipos` (la lista con
        // inactivos que ya tenemos en memoria) porque el backend no lo
        // devuelve.
        if (actuales.some((t) => t.tipo_id === tipoId)) return actuales;
        const tipo = tipos.find((t) => t.tipo_id === tipoId);
        if (!tipo) return actuales;
        const actualizado = { ...tipo, activo: true };
        const lista = [...actuales];
        const idx = lista.findIndex((t) => t.nombre.localeCompare(actualizado.nombre) > 0);
        if (idx === -1) lista.push(actualizado);
        else lista.splice(idx, 0, actualizado);
        return lista;
      });
      await refrescar();
    },
    onError: (e) => {
      setError(getApiErrorMessage(e, "No se pudo cambiar el estado del tipo"));
    },
    onSettled: () => setOcupado(null),
  });

  const mutando = eliminar.isPending || cambiarActivo.isPending;

  return (
    <div className="flex flex-col gap-3 text-gray-800">
      <BotonVolver onClick={onVolver}>Volver a agregar rubro</BotonVolver>

      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="flex items-center gap-2 font-bold text-purple-700">
            <Settings2 className="w-5 h-5" />
            Administrar tipos de rubro
          </h3>
          <p className="text-sm text-gray-600">
            El catálogo es común a todos los créditos: lo que se cambie acá
            aplica a los rubros que se creen de ahora en adelante.
          </p>
        </div>
        <Button
          size="sm"
          onClick={onCrearTipo}
          className="bg-purple-600 hover:bg-purple-700 text-white font-semibold"
        >
          <PlusCircle className="w-4 h-4 mr-2" />
          Crear tipo
        </Button>
      </div>

      {error && <ErrorEnLinea mensaje={error} />}

      {tiposQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-purple-600 font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" />
          Cargando tipos...
        </div>
      ) : tiposQuery.isError ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="flex items-center gap-2 text-red-600 font-semibold text-center">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {getApiErrorMessage(
              tiposQuery.error,
              "No se pudieron cargar los tipos de rubro"
            )}
          </p>
          <Button variant="outline" onClick={() => tiposQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : tipos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 py-10 text-center">
          <Receipt className="w-6 h-6 text-gray-400" />
          <p className="font-semibold text-gray-700">
            Todavía no hay tipos de rubro configurados.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-purple-50">
                <TableHead className="text-purple-900 font-bold">Nombre</TableHead>
                <TableHead className="text-purple-900 font-bold">Descripción</TableHead>
                <TableHead className="text-purple-900 font-bold">Obligatorio</TableHead>
                <TableHead className="text-purple-900 font-bold">Estado</TableHead>
                <TableHead className="text-purple-900 font-bold text-right">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tipos.map((t) => {
                const filaOcupada = mutando && ocupado === t.tipo_id;
                const enConfirmacion = confirmando === t.tipo_id;
                const avisoBloqueo =
                  bloqueado?.tipoId === t.tipo_id ? bloqueado.mensaje : null;
                return (
                  <TableRow
                    key={t.tipo_id}
                    className={t.activo ? "bg-white" : "bg-gray-50/70 text-gray-500"}
                  >
                    <TableCell className="font-semibold text-gray-900">
                      {t.nombre}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      {t.descripcion || "--"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${
                          t.obligatorio
                            ? "bg-red-100 text-red-800 border-red-200"
                            : "bg-gray-100 text-gray-600 border-gray-200"
                        }`}
                      >
                        {t.obligatorio ? "Obligatorio" : "Opcional"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${
                          t.activo
                            ? "bg-green-100 text-green-800 border-green-200"
                            : "bg-gray-100 text-gray-600 border-gray-200"
                        }`}
                      >
                        {t.activo ? "Activo" : "Inactivo"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-end gap-2">
                        {enConfirmacion ? (
                          // Confirmar en la misma fila y no en otro Dialog:
                          // apilar modales de Radix es justo lo que este
                          // componente evita.
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            <span className="text-xs font-semibold text-red-700">
                              ¿Eliminar “{t.nombre}”?
                            </span>
                            <Button
                              size="sm"
                              className="bg-red-600 hover:bg-red-700 text-white"
                              disabled={filaOcupada}
                              onClick={() => {
                                setOcupado(t.tipo_id);
                                eliminar.mutate(t.tipo_id);
                              }}
                            >
                              {filaOcupada && (
                                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                              )}
                              Sí, eliminar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={filaOcupada}
                              onClick={() => setConfirmando(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
                              disabled={filaOcupada}
                              onClick={() => onEditar(t)}
                            >
                              <Pencil className="w-3.5 h-3.5 mr-1" />
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-gray-600 hover:bg-gray-700 text-white border-gray-600"
                              disabled={filaOcupada}
                              onClick={() => {
                                setOcupado(t.tipo_id);
                                cambiarActivo.mutate({
                                  tipoId: t.tipo_id,
                                  activo: !t.activo,
                                });
                              }}
                            >
                              <Power className="w-3.5 h-3.5 mr-1" />
                              {t.activo ? "Desactivar" : "Reactivar"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
                              disabled={filaOcupada}
                              onClick={() => {
                                setError(null);
                                setBloqueado(null);
                                setConfirmando(t.tipo_id);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
                              Eliminar
                            </Button>
                          </div>
                        )}

                        {avisoBloqueo && (
                          <div className="flex flex-col items-end gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left">
                            <p className="flex items-start gap-2 text-xs text-amber-800">
                              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                              {avisoBloqueo}
                            </p>
                            {t.activo && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                                disabled={filaOcupada}
                                onClick={() => {
                                  setOcupado(t.tipo_id);
                                  cambiarActivo.mutate({
                                    tipoId: t.tipo_id,
                                    activo: false,
                                  });
                                }}
                              >
                                {filaOcupada && (
                                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                )}
                                Desactivarlo en su lugar
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-gray-500">
        Un tipo <b>inactivo</b> deja de ofrecerse al crear rubros, pero los
        rubros ya creados con él siguen intactos. <b>Eliminar</b> solo funciona
        con tipos que nunca se usaron.
      </p>
    </div>
  );
}

/* ---------------------------------------------------- Editar tipo rubro --- */

function VistaEditarTipo({
  tipo,
  onVolver,
  onGuardado,
}: {
  tipo: TipoRubro;
  onVolver: () => void;
  onGuardado: () => void;
}) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState(tipo.nombre);
  const [descripcion, setDescripcion] = useState(tipo.descripcion ?? "");
  const [obligatorio, setObligatorio] = useState(tipo.obligatorio);
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () =>
      editarTipoRubro(tipo.tipo_id, {
        nombre: nombre.trim(),
        // Vaciar el campo tiene que poder borrar la descripción, así que la
        // cadena vacía se manda igual —a diferencia de la creación, donde
        // omitirla es lo mismo que no tenerla—.
        descripcion: descripcion.trim(),
        obligatorio,
      }),
    onSuccess: async () => {
      toast.success("Tipo de rubro actualizado");
      await queryClient.invalidateQueries({ queryKey: [QK_TIPOS] });
      onGuardado();
    },
    onError: (e) => {
      setError(getApiErrorMessage(e, "No se pudo editar el tipo de rubro"));
    },
  });

  const submit = () => {
    setError(null);
    if (!nombre.trim()) return setError("El nombre del tipo es obligatorio");
    guardar.mutate();
  };

  return (
    <div className="flex flex-col gap-3 text-gray-800">
      <BotonVolver onClick={onVolver}>Volver a los tipos</BotonVolver>

      <div>
        <h3 className="flex items-center gap-2 font-bold text-blue-700">
          <Pencil className="w-5 h-5" />
          Editar tipo de rubro
        </h3>
        <p className="text-sm text-gray-600">
          Los rubros ya creados con este tipo conservan su monto y su
          descripción; acá solo cambia el catálogo.
        </p>
      </div>

      <div>
        <Label htmlFor="edit-tipo-nombre" className="mb-1 block">
          Nombre
        </Label>
        <Input
          id="edit-tipo-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="edit-tipo-desc" className="mb-1 block">
          Descripción <span className="text-gray-400 font-normal">(opcional)</span>
        </Label>
        <Input
          id="edit-tipo-desc"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 accent-purple-600"
          checked={obligatorio}
          onChange={(e) => setObligatorio(e.target.checked)}
        />
        Obligatorio
      </label>
      <p className="-mt-1 text-xs text-gray-500">
        Un tipo obligatorio se puede cobrar aunque el crédito esté en mora, y
        solo lo puede usar un administrador.
      </p>

      {error && <ErrorEnLinea mensaje={error} />}

      <DialogFooter className="gap-2">
        <Button
          variant="outline"
          className="bg-gray-600 hover:bg-gray-700 text-white font-semibold border-gray-600"
          disabled={guardar.isPending}
          onClick={onVolver}
        >
          Cancelar
        </Button>
        <Button
          onClick={submit}
          className="bg-blue-600 hover:bg-blue-700 text-white"
          disabled={guardar.isPending}
        >
          {guardar.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Guardar cambios
        </Button>
      </DialogFooter>
    </div>
  );
}

/* ------------------------------------------------------------ Historial --- */

function VistaHistorial({
  rubro,
  onVolver,
}: {
  rubro: RubroCredito;
  onVolver: () => void;
}) {
  const historialQuery = useQuery({
    queryKey: ["rubroHistorial", rubro.rubro_id],
    queryFn: () => getHistorialRubro(rubro.rubro_id),
  });

  const eventos = historialQuery.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <BotonVolver onClick={onVolver} />

      <div>
        <h3 className="flex items-center gap-2 font-bold text-gray-800">
          <History className="w-5 h-5" />
          Historial del rubro
        </h3>
        <p className="text-sm text-gray-600">
          {rubro.tipo_nombre}
          {rubro.descripcion ? ` · ${rubro.descripcion}` : ""}
        </p>
      </div>

      {historialQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-gray-600 font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" />
          Cargando historial...
        </div>
      ) : historialQuery.isError ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="flex items-center gap-2 text-red-600 font-semibold text-center">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {getApiErrorMessage(historialQuery.error, "No se pudo cargar el historial")}
          </p>
          <Button variant="outline" onClick={() => historialQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : eventos.length === 0 ? (
        <div className="py-8 text-center text-gray-500">
          Este rubro todavía no tiene eventos registrados.
        </div>
      ) : (
        <div className="max-h-[55vh] overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-100">
          {eventos.map((ev) => (
            <div key={ev.historial_id} className="flex flex-col gap-1 bg-white px-4 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center rounded-md border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700">
                  {ev.tipo_evento}
                </span>
                <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                  {ev.origen}
                </span>
                <span className="text-gray-400 text-xs ml-auto flex items-center gap-3 flex-wrap justify-end">
                  <span className="flex items-center gap-1" title={ev.usuario_email ?? undefined}>
                    <UserRound className="w-3 h-3 shrink-0" />
                    {autorDe(ev)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 shrink-0" />
                    {fmtFechaHoraGT(ev.created_at)}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-4 flex-wrap text-sm">
                {(ev.monto_anterior !== null || ev.monto_nuevo !== null) && (
                  <span className="text-gray-700">
                    Monto:{" "}
                    <span className="text-gray-400 line-through tabular-nums">
                      {ev.monto_anterior === null ? "—" : fmtQ(ev.monto_anterior)}
                    </span>{" "}
                    &rarr;{" "}
                    <span className="font-semibold tabular-nums">
                      {ev.monto_nuevo === null ? "—" : fmtQ(ev.monto_nuevo)}
                    </span>
                  </span>
                )}
                {(ev.saldo_anterior !== null || ev.saldo_nuevo !== null) && (
                  <span className="text-gray-700">
                    Saldo:{" "}
                    <span className="text-gray-400 line-through tabular-nums">
                      {ev.saldo_anterior === null ? "—" : fmtQ(ev.saldo_anterior)}
                    </span>{" "}
                    &rarr;{" "}
                    <span className="font-semibold tabular-nums">
                      {ev.saldo_nuevo === null ? "—" : fmtQ(ev.saldo_nuevo)}
                    </span>
                  </span>
                )}
              </div>

              {ev.motivo && <p className="text-xs text-gray-500 italic">“{ev.motivo}”</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
