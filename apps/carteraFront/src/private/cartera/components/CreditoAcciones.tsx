/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Download,
  DollarSign,
  Eye,
  FileCheck,
  History,
  Pencil,
  Receipt,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  canActivate,
  canCancel,
  canEdit,
  canMarkCaido,
  canViewPayments,
  canViewReports,
} from "../lib/permisosCredito";

/**
 * Barra de acciones de un crédito (fila expandida de la lista).
 *
 * Antes estaba escrita DOS veces —una en `DesktopView` y otra en `MobileView`
 * de `CreditsPaymentsData.tsx`—, con 12 botones sueltos en una sola línea y
 * las condiciones de visibilidad copiadas en ambos lados (la vista móvil ya se
 * había quedado sin "Reactivar Crédito"). Acá viven una sola vez.
 *
 * Las 12 acciones son las mismas de antes, reagrupadas:
 *  - visibles: Registrar pago · Ver pagos · Rubros
 *  - menú "Mora": crear mora · historial de mora
 *  - menú "Más acciones": ajustes · estado · reportes
 *
 * Un menú que se queda sin ítems (por rol o por estado del crédito) no se
 * renderiza: nunca debe poder abrirse vacío.
 */

/*
 * Los `DropdownMenu*` salen del wrapper del proyecto (`@/components/ui`), no de
 * `@radix-ui` a pelo: el wrapper es el que mete el Portal, las animaciones de
 * apertura/cierre y los estilos base, y es lo que usa el resto de la app.
 *
 * Las clases de acá sólo escriben lo que DIFIERE de esa base; lo que el wrapper
 * ya trae (`p-1`, `z-50`, el `border`/`rounded`/`shadow` por defecto, el
 * `flex items-center gap-2 text-sm` de los ítems) se quitó. El wrapper pasa
 * `className` por `cn`, o sea `tailwind-merge`, así que lo que sí se escribe
 * pisa limpiamente a la base en vez de depender del orden del CSS generado —
 * por eso las clases de cada ítem van en el `DropdownMenuItem` y no sueltas en
 * el `<button>` hijo, que quedaría fuera de ese merge.
 */
const CLASE_MENU = "bg-white border-blue-200 shadow-xl rounded-xl min-w-[230px]";
const CLASE_ENCABEZADO =
  "px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400";
const CLASE_SEPARADOR = "bg-blue-100";

// Tailwind no puede generar clases armadas en tiempo de ejecución, así que cada
// combinación se escribe completa. Los colores son los que ya tenía cada botón.
// El `[&_svg…]:text-current` no es decorativo: la base del wrapper pinta de
// `text-muted-foreground` todo `svg` que no traiga su propia clase `text-`, y
// sin esto los iconos de cada ítem se veían grises en vez del color del ítem.
const ITEM_BASE =
  "w-full px-3 py-2 rounded-lg font-semibold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed [&_svg:not([class*='text-'])]:text-current";
const ITEM = {
  purple: `${ITEM_BASE} hover:bg-purple-50 text-purple-700`,
  indigo: `${ITEM_BASE} hover:bg-indigo-50 text-indigo-700`,
  yellow: `${ITEM_BASE} hover:bg-yellow-50 text-yellow-700`,
  emerald: `${ITEM_BASE} hover:bg-emerald-50 text-emerald-700`,
  blue: `${ITEM_BASE} hover:bg-blue-50 text-blue-700`,
  red: `${ITEM_BASE} hover:bg-red-50 text-red-700`,
  gray: `${ITEM_BASE} hover:bg-gray-100 text-gray-700`,
  green: `${ITEM_BASE} hover:bg-green-50 text-green-700`,
} as const;

export type CreditoAccionesProps = {
  item: any;
  user: any;
  navigate: (ruta: string) => void;
  /** Abre el modal de cancelación del crédito. */
  handleOpenModal: (creditId: number) => void;
  /** Abre el modal de edición del crédito. */
  handleOpenEdit: (credit: any, inversionistas: any, usuario?: any) => void;
  setSelectedCreditMora: (credito: any) => void;
  setOpenMoraModal: (open: boolean) => void;
  setSelectedCreditHistorialMora: (credito: any) => void;
  setOpenHistorialMoraModal: (open: boolean) => void;
  setSelectedCreditMarcarCuotas: (sifco: string) => void;
  setOpenMarcarCuotasModal: (open: boolean) => void;
  setSelectedCreditFechaInicio: (
    v: { sifco: string; fechaActual: string | null } | null
  ) => void;
  setFechaInicioModalOpen: (open: boolean) => void;
  setSelectedCreditCaido: (creditId: number | null) => void;
  setCaidoModalOpen: (open: boolean) => void;
  setSelectedCreditForReport: (credito: any) => void;
  setReportModalOpen: (open: boolean) => void;
  toggleCancelacionMutation: any;
  activateCreditMutation: any;
  refetch: () => void;
  /** Abre el modal de Rubros del crédito. */
  onAbrirRubros: () => void;
};

export function CreditoAcciones({
  item,
  user,
  navigate,
  handleOpenModal,
  handleOpenEdit,
  setSelectedCreditMora,
  setOpenMoraModal,
  setSelectedCreditHistorialMora,
  setOpenHistorialMoraModal,
  setSelectedCreditMarcarCuotas,
  setOpenMarcarCuotasModal,
  setSelectedCreditFechaInicio,
  setFechaInicioModalOpen,
  setSelectedCreditCaido,
  setCaidoModalOpen,
  setSelectedCreditForReport,
  setReportModalOpen,
  toggleCancelacionMutation,
  activateCreditMutation,
  refetch,
  onAbrirRubros,
}: CreditoAccionesProps) {
  const credito = item.creditos;
  const estado = credito.statusCredit;
  const esAdmin = user?.role === "ADMIN";

  // ── Condiciones de visibilidad (las mismas de la barra vieja) ──────────────
  const verRegistrarPago = user?.role === "ADMIN" || user?.role === "ASESOR";
  const verPagos = canViewPayments(estado);
  // Los rubros dejaron de ser ADMIN-only: el asesor también registra cobros
  // adicionales (los tipos obligatorios se le filtran dentro del modal).
  const verRubros = user?.role === "ADMIN" || user?.role === "ASESOR";

  const verCrearMora = canEdit(estado) && esAdmin;
  const verHistorialMora =
    user?.role === "ADMIN" || user?.role === "CONTA" || user?.role === "ASESOR";

  const verEditar = canEdit(estado) && esAdmin;
  const verMarcarCuotas = esAdmin;
  const verFechaInicio = esAdmin;

  // El `&& esAdmin` es NUEVO. "Cancelar crédito" era la única acción de estado
  // sin gate de rol —venía así de las dos barras viejas—, así que un CONTA veía
  // la opción de cancelar. Las otras tres del grupo (caído, activar
  // cancelación, reactivar) ya eran ADMIN-only; cancelar no tiene por qué ser
  // la excepción, y esta es la definición que ahora comparten las dos vistas.
  const verCancelar = canCancel(estado) && esAdmin;
  const verMarcarCaido = canMarkCaido(estado) && esAdmin;
  const verActivarCancelacion = canActivate(estado) && esAdmin;
  const verReactivar = canActivate(estado) && esAdmin;

  const verReportes =
    canViewReports(estado) && (user?.role === "ADMIN" || user?.role === "ASESOR");

  // ── Agrupación ────────────────────────────────────────────────────────────
  const hayMenuMora = verCrearMora || verHistorialMora;
  const hayAjustes = verEditar || verMarcarCuotas || verFechaInicio;
  const hayEstado =
    verCancelar || verMarcarCaido || verActivarCancelacion || verReactivar;
  const hayReportes = verReportes;
  const hayMenuMas = hayAjustes || hayEstado || hayReportes;

  // Los ítems de estado viven dentro de un menú de Radix, que se cierra al
  // seleccionar: el "Activando..." de un ítem se renderiza en un menú ya
  // desmontado y el usuario no ve nada. El feedback va entonces donde SÍ
  // sobrevive a la selección: un toast de progreso y el disparador del menú
  // deshabilitado, que además impide disparar la misma mutación dos veces.
  const mutandoEstado =
    !!toggleCancelacionMutation?.isPending || !!activateCreditMutation?.isPending;

  const detener = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {/* ── Acciones visibles ── */}
      {verRegistrarPago && (
        <Button
          size="sm"
          className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white font-semibold"
          onClick={(e) => {
            detener(e);
            navigate(`/realizarPago?sifco=${credito.numero_credito_sifco}`);
          }}
        >
          <DollarSign className="w-4 h-4" />
          Registrar pago
        </Button>
      )}

      {verPagos && (
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
          onClick={(e) => {
            detener(e);
            navigate(`/pagos/${credito.numero_credito_sifco}`);
          }}
        >
          <Eye className="w-4 h-4" />
          Ver pagos
        </Button>
      )}

      {verRubros && (
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white border-purple-600"
          onClick={(e) => {
            detener(e);
            onAbrirRubros();
          }}
        >
          <Receipt className="w-4 h-4" />
          Rubros
        </Button>
      )}

      {/* ── Menú: Mora ── */}
      {hayMenuMora && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600"
              onClick={detener}
            >
              <History className="w-4 h-4" />
              Mora
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={CLASE_MENU}>
            {verCrearMora && (
              <DropdownMenuItem asChild className={ITEM.purple}>
                <button
                  onClick={(e) => {
                    detener(e);
                    setSelectedCreditMora(credito);
                    setOpenMoraModal(true);
                  }}
                >
                  ➕ Crear mora
                </button>
              </DropdownMenuItem>
            )}
            {verHistorialMora && (
              <DropdownMenuItem asChild className={ITEM.indigo}>
                <button
                  onClick={(e) => {
                    detener(e);
                    setSelectedCreditHistorialMora(credito);
                    setOpenHistorialMoraModal(true);
                  }}
                >
                  <History className="w-4 h-4" />
                  Ver historial de mora
                </button>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* ── Menú: Más acciones ── */}
      {hayMenuMas && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1 bg-gray-600 hover:bg-gray-700 text-white border-gray-600"
              disabled={mutandoEstado}
              onClick={detener}
            >
              {mutandoEstado ? "Procesando..." : "Más acciones"}
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={CLASE_MENU}>
            {hayAjustes && (
              <>
                <DropdownMenuLabel className={CLASE_ENCABEZADO}>
                  Ajustes
                </DropdownMenuLabel>
                {verEditar && (
                  <DropdownMenuItem asChild className={ITEM.yellow}>
                    <button
                      onClick={(e) => {
                        detener(e);
                        handleOpenEdit(
                          {
                            ...credito,
                            creditos_inversionistas_espejo:
                              item.creditos_inversionistas_espejo,
                            tiene_pagos_sin_liquidar:
                              item.tiene_pagos_sin_liquidar,
                          },
                          item.inversionistas,
                          item.usuarios
                        );
                      }}
                    >
                      <Pencil className="w-4 h-4" />
                      Editar crédito
                    </button>
                  </DropdownMenuItem>
                )}
                {verMarcarCuotas && (
                  <DropdownMenuItem asChild className={ITEM.emerald}>
                    <button
                      onClick={(e) => {
                        detener(e);
                        setSelectedCreditMarcarCuotas(
                          credito.numero_credito_sifco
                        );
                        setOpenMarcarCuotasModal(true);
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Marcar cuotas
                    </button>
                  </DropdownMenuItem>
                )}
                {verFechaInicio && (
                  <DropdownMenuItem asChild className={ITEM.blue}>
                    <button
                      onClick={(e) => {
                        detener(e);
                        setSelectedCreditFechaInicio({
                          sifco: credito.numero_credito_sifco,
                          fechaActual: item.fecha_inicio ?? null,
                        });
                        setFechaInicioModalOpen(true);
                      }}
                    >
                      <CalendarClock className="w-4 h-4" />
                      Cambiar fecha de inicio
                    </button>
                  </DropdownMenuItem>
                )}
              </>
            )}

            {hayAjustes && hayEstado && (
              <DropdownMenuSeparator className={CLASE_SEPARADOR} />
            )}

            {hayEstado && (
              <>
                <DropdownMenuLabel className={CLASE_ENCABEZADO}>
                  Estado
                </DropdownMenuLabel>
                {verCancelar && (
                  <DropdownMenuItem asChild className={ITEM.red}>
                    <button
                      onClick={(e) => {
                        detener(e);
                        handleOpenModal(credito.credito_id);
                      }}
                    >
                      <XCircle className="w-4 h-4" />
                      Cancelar crédito
                    </button>
                  </DropdownMenuItem>
                )}
                {verMarcarCaido && (
                  <DropdownMenuItem asChild className={ITEM.gray}>
                    <button
                      onClick={(e) => {
                        detener(e);
                        setSelectedCreditCaido(credito.credito_id);
                        setCaidoModalOpen(true);
                      }}
                    >
                      <XCircle className="w-4 h-4" />
                      Marcar como caído
                    </button>
                  </DropdownMenuItem>
                )}
                {verActivarCancelacion && (
                  <DropdownMenuItem asChild className={ITEM.green}>
                    <button
                      disabled={mutandoEstado}
                      onClick={(e) => {
                        detener(e);
                        const aviso = toast.loading("Activando cancelación...");
                        toggleCancelacionMutation.mutate(
                          { creditId: credito.credito_id, activo: true },
                          {
                            onSuccess: () => {
                              toast.success(
                                "Cancelación activada correctamente",
                                { id: aviso }
                              );
                              refetch();
                            },
                            onError: (err: any) => {
                              toast.error(
                                err?.message || "Error al activar cancelación",
                                { id: aviso }
                              );
                            },
                          }
                        );
                      }}
                    >
                      <FileCheck className="w-4 h-4" />
                      Activar cancelación
                    </button>
                  </DropdownMenuItem>
                )}
                {verReactivar && (
                  <DropdownMenuItem asChild className={ITEM.blue}>
                    <button
                      disabled={mutandoEstado}
                      onClick={(e) => {
                        detener(e);
                        const aviso = toast.loading("Reactivando crédito...");
                        activateCreditMutation.mutate(
                          {
                            creditId: credito.credito_id,
                            accion: "ACTIVAR",
                          },
                          {
                            onSuccess: () => {
                              toast.success("Crédito reactivado correctamente", {
                                id: aviso,
                              });
                              refetch();
                            },
                            onError: (err: any) => {
                              toast.error(
                                err?.message || "Error al reactivar crédito",
                                { id: aviso }
                              );
                            },
                          }
                        );
                      }}
                    >
                      <RefreshCw className="w-4 h-4" />
                      Reactivar crédito
                    </button>
                  </DropdownMenuItem>
                )}
              </>
            )}

            {(hayAjustes || hayEstado) && hayReportes && (
              <DropdownMenuSeparator className={CLASE_SEPARADOR} />
            )}

            {hayReportes && (
              <>
                <DropdownMenuLabel className={CLASE_ENCABEZADO}>
                  Reportes
                </DropdownMenuLabel>
                <DropdownMenuItem asChild className={ITEM.green}>
                  <button
                    onClick={(e) => {
                      detener(e);
                      setSelectedCreditForReport(credito);
                      setReportModalOpen(true);
                    }}
                  >
                    <Download className="w-4 h-4" />
                    Ver reportes
                  </button>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

    </div>
  );
}

export default CreditoAcciones;
