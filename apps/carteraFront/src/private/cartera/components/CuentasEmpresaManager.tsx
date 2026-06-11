import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  History,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
  useActualizarCuentaEmpresa,
  useCrearCuentaEmpresa,
  useCrearMovimientoCuenta,
  useCuentasEmpresa,
  useEliminarCuentaEmpresa,
  useMovimientosCuenta,
} from "../hooks/cuentasEmpresa";
import { useBancos } from "../hooks/bancos";
import type {
  CuentaEmpresa,
  MonedaCuenta,
  MovimientoCuentaEmpresa,
  TipoMovimientoCuenta,
} from "../services/services";
import { useIsMobile } from "../hooks/useIsMobile";

// Defaultea a quetzales si el backend todavía no devuelve el campo (compat).
function getMoneda(c?: { moneda?: MonedaCuenta | null }): MonedaCuenta {
  return c?.moneda === "dolares" ? "dolares" : "quetzales";
}

function getSaldo(c?: { saldo_actual?: string | number | null }): number {
  if (c?.saldo_actual === null || c?.saldo_actual === undefined) return 0;
  const n = typeof c.saldo_actual === "string" ? Number(c.saldo_actual) : c.saldo_actual;
  return Number.isFinite(n) ? n : 0;
}

// Formato de moneda según la cuenta
function formatSaldo(monto: string | number | null | undefined, moneda: MonedaCuenta) {
  const value =
    monto === null || monto === undefined
      ? 0
      : typeof monto === "string"
      ? Number(monto) || 0
      : monto;
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: moneda === "dolares" ? "USD" : "GTQ",
    minimumFractionDigits: 2,
  }).format(value);
}

const MONEDA_LABEL: Record<MonedaCuenta, string> = {
  quetzales: "GTQ",
  dolares: "USD",
};

export function CuentasEmpresaManager() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [soloActivas, setSoloActivas] = useState(false);

  const { data: cuentas = [], isLoading } = useCuentasEmpresa({
    soloActivas,
  });

  // Filtro client-side por nombre/banco (instantáneo, sin pegarle al server por cada tecla).
  const cuentasFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cuentas;
    return cuentas.filter(
      (c) =>
        c.nombreCuenta.toLowerCase().includes(q) ||
        c.banco.toLowerCase().includes(q) ||
        c.numeroCuenta.toLowerCase().includes(q)
    );
  }, [cuentas, search]);

  // Estado de los dialogs
  const [cuentaDialog, setCuentaDialog] = useState<{
    open: boolean;
    cuenta: CuentaEmpresa | null;
  }>({ open: false, cuenta: null });

  const [movDialog, setMovDialog] = useState<{
    open: boolean;
    cuentaId: number | null;
  }>({ open: false, cuentaId: null });

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    cuenta: CuentaEmpresa | null;
  }>({ open: false, cuenta: null });

  const [movimientosDialog, setMovimientosDialog] = useState<{
    open: boolean;
    cuenta: CuentaEmpresa | null;
  }>({ open: false, cuenta: null });

  const eliminar = useEliminarCuentaEmpresa();

  // Saldo total agregado (solo informativo, agrupado por moneda)
  const totales = useMemo(() => {
    const acc: Record<MonedaCuenta, number> = { quetzales: 0, dolares: 0 };
    for (const c of cuentas) {
      acc[getMoneda(c)] += getSaldo(c);
    }
    return acc;
  }, [cuentas]);

  return (
    <div className="space-y-6 mx-auto w-full max-w-7xl text-slate-900">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2 text-slate-900">
            <Wallet className="h-6 w-6 text-blue-600" />
            Cuentas de empresa
          </h1>
          <p className="text-sm text-slate-500">
            Gestiona cuentas bancarias y registra movimientos de dinero.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setMovDialog({ open: true, cuentaId: null })}
          >
            <Banknote className="mr-2 h-4 w-4" />
            Nuevo movimiento
          </Button>
          <Button
            onClick={() => setCuentaDialog({ open: true, cuenta: null })}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nueva cuenta
          </Button>
        </div>
      </div>

      {/* Tarjetas resumen */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ResumenCard
          label="Total en quetzales"
          valor={formatSaldo(totales.quetzales, "quetzales")}
          color="text-emerald-600"
        />
        <ResumenCard
          label="Total en dólares"
          valor={formatSaldo(totales.dolares, "dolares")}
          color="text-sky-600"
        />
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar por nombre, banco o número..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="solo-activas"
            checked={soloActivas}
            onCheckedChange={setSoloActivas}
          />
          <Label htmlFor="solo-activas" className="cursor-pointer text-slate-700">
            Solo activas
          </Label>
        </div>
      </div>

      {/* Listado */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Cargando cuentas...
        </div>
      ) : cuentasFiltradas.length === 0 ? (
        <Card className="bg-white">
          <CardContent className="py-12 text-center text-slate-500">
            No se encontraron cuentas con los filtros actuales.
          </CardContent>
        </Card>
      ) : isMobile ? (
        <div className="space-y-3">
          {cuentasFiltradas.map((cuenta) => (
            <CuentaCard
              key={cuenta.cuentaId}
              cuenta={cuenta}
              onEdit={() => setCuentaDialog({ open: true, cuenta })}
              onMovimiento={() =>
                setMovDialog({ open: true, cuentaId: cuenta.cuentaId })
              }
              onVerMovimientos={() =>
                setMovimientosDialog({ open: true, cuenta })
              }
              onDelete={() => setDeleteDialog({ open: true, cuenta })}
            />
          ))}
        </div>
      ) : (
        <Card className="bg-white shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="text-slate-700 font-semibold">Empresa</TableHead>
                  <TableHead className="text-slate-700 font-semibold">Banco</TableHead>
                  <TableHead className="text-slate-700 font-semibold">Número</TableHead>
                  <TableHead className="text-slate-700 font-semibold">Moneda</TableHead>
                  <TableHead className="text-right text-slate-700 font-semibold">Saldo</TableHead>
                  <TableHead className="text-slate-700 font-semibold">Estado</TableHead>
                  <TableHead className="text-right text-slate-700 font-semibold">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cuentasFiltradas.map((cuenta) => (
                  <TableRow key={cuenta.cuentaId} className="text-slate-800">
                    <TableCell className="font-medium text-slate-900">
                      {cuenta.nombreCuenta}
                    </TableCell>
                    <TableCell>{cuenta.banco}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {cuenta.numeroCuenta}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-slate-700 border-slate-300">
                        {MONEDA_LABEL[getMoneda(cuenta)]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-slate-900">
                      {formatSaldo(cuenta.saldo_actual, getMoneda(cuenta))}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={cuenta.activo ? "default" : "secondary"}
                        className={
                          cuenta.activo
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0"
                            : "bg-slate-200 text-slate-700 border-0"
                        }
                      >
                        {cuenta.activo ? "Activa" : "Inactiva"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Ver movimientos"
                          className="text-slate-700 hover:text-indigo-700 hover:bg-indigo-50"
                          onClick={() =>
                            setMovimientosDialog({ open: true, cuenta })
                          }
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Registrar movimiento"
                          className="text-slate-700 hover:text-blue-700 hover:bg-blue-50"
                          onClick={() =>
                            setMovDialog({
                              open: true,
                              cuentaId: cuenta.cuentaId,
                            })
                          }
                        >
                          <Banknote className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Editar"
                          className="text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                          onClick={() =>
                            setCuentaDialog({ open: true, cuenta })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Desactivar"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() =>
                            setDeleteDialog({ open: true, cuenta })
                          }
                          disabled={!cuenta.activo}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <CuentaDialog
        open={cuentaDialog.open}
        cuenta={cuentaDialog.cuenta}
        onClose={() => setCuentaDialog({ open: false, cuenta: null })}
      />

      <MovimientoDialog
        open={movDialog.open}
        cuentaIdInicial={movDialog.cuentaId}
        cuentas={cuentas}
        onClose={() => setMovDialog({ open: false, cuentaId: null })}
      />

      <MovimientosListDialog
        open={movimientosDialog.open}
        cuenta={movimientosDialog.cuenta}
        onClose={() => setMovimientosDialog({ open: false, cuenta: null })}
        onAgregar={() => {
          if (movimientosDialog.cuenta) {
            setMovDialog({
              open: true,
              cuentaId: movimientosDialog.cuenta.cuentaId,
            });
          }
        }}
      />

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) =>
          !open && setDeleteDialog({ open: false, cuenta: null })
        }
      >
        <AlertDialogContent className="bg-white text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">Desactivar cuenta</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600">
              La cuenta <b>{deleteDialog.cuenta?.nombreCuenta}</b> ({deleteDialog.cuenta?.banco}) se marcará como inactiva. Sus movimientos históricos no se eliminan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteDialog.cuenta) return;
                eliminar.mutate(deleteDialog.cuenta.cuentaId, {
                  onSettled: () => setDeleteDialog({ open: false, cuenta: null }),
                });
              }}
            >
              {eliminar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Desactivar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ----------------------------------------------------------------
// Sub-componentes
// ----------------------------------------------------------------

function ResumenCard({
  label,
  valor,
  color,
}: {
  label: string;
  valor: string;
  color: string;
}) {
  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold tabular-nums ${color}`}>{valor}</p>
      </CardContent>
    </Card>
  );
}

function CuentaCard({
  cuenta,
  onEdit,
  onMovimiento,
  onVerMovimientos,
  onDelete,
}: {
  cuenta: CuentaEmpresa;
  onEdit: () => void;
  onMovimiento: () => void;
  onVerMovimientos: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="overflow-hidden bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base text-slate-900">{cuenta.nombreCuenta}</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              {cuenta.banco} · <span className="font-mono">{cuenta.numeroCuenta}</span>
            </p>
          </div>
          <Badge
            variant={cuenta.activo ? "default" : "secondary"}
            className={
              cuenta.activo
                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0"
                : "bg-slate-200 text-slate-700 border-0"
            }
          >
            {cuenta.activo ? "Activa" : "Inactiva"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">
            Saldo actual
          </p>
          <p className="text-2xl font-bold tabular-nums text-slate-900">
            {formatSaldo(cuenta.saldo_actual, getMoneda(cuenta))}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={onMovimiento}>
            <Banknote className="mr-2 h-4 w-4" />
            Movimiento
          </Button>
          <Button size="sm" variant="outline" onClick={onVerMovimientos} title="Ver movimientos">
            <History className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit} title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDelete}
            disabled={!cuenta.activo}
            title="Desactivar"
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------
// Dialog: crear / editar cuenta
// ----------------------------------------------------------------

function CuentaDialog({
  open,
  cuenta,
  onClose,
}: {
  open: boolean;
  cuenta: CuentaEmpresa | null;
  onClose: () => void;
}) {
  const isEdit = !!cuenta;
  const [form, setForm] = useState({
    nombreCuenta: "",
    banco: "",
    numeroCuenta: "",
    descripcion: "",
    moneda: "quetzales" as MonedaCuenta,
    activo: true,
  });

  // Reseteo / precarga cuando se abre el dialog
  const crear = useCrearCuentaEmpresa();
  const actualizar = useActualizarCuentaEmpresa();
  const isPending = crear.isPending || actualizar.isPending;

  // Bancos para el select (carga en demanda cuando abre el dialog)
  const { bancos, loading: loadingBancos, loadBancos } = useBancos();
  useEffect(() => {
    if (open && bancos.length === 0) loadBancos();
  }, [open, bancos.length, loadBancos]);

  // sincroniza con la cuenta a editar al abrir
  useMemoSync(open, cuenta, setForm);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      nombreCuenta: form.nombreCuenta.trim(),
      banco: form.banco.trim(),
      numeroCuenta: form.numeroCuenta.trim(),
      descripcion: form.descripcion.trim() || undefined,
      moneda: form.moneda,
    };

    if (!payload.nombreCuenta || !payload.banco || !payload.numeroCuenta) return;

    if (isEdit && cuenta) {
      actualizar.mutate(
        { cuentaId: cuenta.cuentaId, payload: { ...payload, activo: form.activo } },
        { onSuccess: (res) => res.success && onClose() }
      );
    } else {
      crear.mutate(payload, {
        onSuccess: (res) => res.success && onClose(),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-900">
            {isEdit ? "Editar cuenta" : "Nueva cuenta"}
          </DialogTitle>
          <DialogDescription className="text-slate-600">
            {isEdit
              ? "Actualiza los datos de la cuenta. El saldo no se modifica desde aquí."
              : "Crea una nueva cuenta bancaria de empresa."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nombreCuenta">Nombre / empresa *</Label>
            <Input
              id="nombreCuenta"
              value={form.nombreCuenta}
              onChange={(e) =>
                setForm((f) => ({ ...f, nombreCuenta: e.target.value }))
              }
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="banco">Banco *</Label>
              <Select
                value={form.banco}
                onValueChange={(v) => setForm((f) => ({ ...f, banco: v }))}
                disabled={loadingBancos}
              >
                <SelectTrigger id="banco" className="w-full">
                  <SelectValue
                    placeholder={
                      loadingBancos ? "Cargando..." : "Selecciona un banco"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="z-[100] bg-white text-slate-900 [&_*]:text-slate-900">
                  {/* Si la cuenta tiene un banco que ya no existe en la tabla bancos
                      (datos viejos o ortografía distinta), igual lo mostramos como
                      opción para no perder el valor al editar. */}
                  {form.banco &&
                    !bancos.some((b) => b.nombre === form.banco) && (
                      <SelectItem value={form.banco}>
                        {form.banco} <span className="opacity-60">(actual)</span>
                      </SelectItem>
                    )}
                  {bancos.map((b) => (
                    <SelectItem key={b.banco_id} value={b.nombre}>
                      {b.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="moneda">Moneda</Label>
              <Select
                value={form.moneda}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, moneda: v as MonedaCuenta }))
                }
              >
                <SelectTrigger id="moneda">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100] bg-white text-slate-900 [&_*]:text-slate-900">
                  <SelectItem value="quetzales">GTQ — Quetzales</SelectItem>
                  <SelectItem value="dolares">USD — Dólares</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="numeroCuenta">Número de cuenta *</Label>
            <Input
              id="numeroCuenta"
              value={form.numeroCuenta}
              onChange={(e) =>
                setForm((f) => ({ ...f, numeroCuenta: e.target.value }))
              }
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              rows={2}
              value={form.descripcion}
              onChange={(e) =>
                setForm((f) => ({ ...f, descripcion: e.target.value }))
              }
            />
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <Switch
                id="activo"
                checked={form.activo}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, activo: checked }))
                }
              />
              <Label htmlFor="activo">Cuenta activa</Label>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                "Guardar cambios"
              ) : (
                "Crear cuenta"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Helper para sincronizar el form con la cuenta cuando se abre el dialog
function useMemoSync(
  open: boolean,
  cuenta: CuentaEmpresa | null,
  setForm: React.Dispatch<
    React.SetStateAction<{
      nombreCuenta: string;
      banco: string;
      numeroCuenta: string;
      descripcion: string;
      moneda: MonedaCuenta;
      activo: boolean;
    }>
  >
) {
  useEffect(() => {
    if (!open) return;
    if (cuenta) {
      setForm({
        nombreCuenta: cuenta.nombreCuenta,
        banco: cuenta.banco,
        numeroCuenta: cuenta.numeroCuenta,
        descripcion: cuenta.descripcion ?? "",
        moneda: cuenta.moneda,
        activo: cuenta.activo,
      });
    } else {
      setForm({
        nombreCuenta: "",
        banco: "",
        numeroCuenta: "",
        descripcion: "",
        moneda: "quetzales",
        activo: true,
      });
    }
  }, [open, cuenta, setForm]);
}

// ----------------------------------------------------------------
// Dialog: registrar movimiento
// ----------------------------------------------------------------

function MovimientoDialog({
  open,
  cuentaIdInicial,
  cuentas,
  onClose,
}: {
  open: boolean;
  cuentaIdInicial: number | null;
  cuentas: CuentaEmpresa[];
  onClose: () => void;
}) {
  const [cuentaId, setCuentaId] = useState<number | null>(cuentaIdInicial);
  const [tipo, setTipo] = useState<TipoMovimientoCuenta>("ingreso");
  const [monto, setMonto] = useState<string>("");
  const [motivo, setMotivo] = useState<string>("");

  const crear = useCrearMovimientoCuenta();

  // Reset cuando abre el dialog
  useEffect(() => {
    if (open) {
      setCuentaId(cuentaIdInicial);
      setTipo("ingreso");
      setMonto("");
      setMotivo("");
    }
  }, [open, cuentaIdInicial]);

  const cuentaSeleccionada = cuentas.find((c) => c.cuentaId === cuentaId) ?? null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cuentaId) return;
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) return;

    crear.mutate(
      {
        cuentaId,
        payload: {
          tipo,
          monto: montoNum,
          motivo: motivo.trim() || undefined,
        },
      },
      { onSuccess: (res) => res.success && onClose() }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-900">Nuevo movimiento</DialogTitle>
          <DialogDescription className="text-slate-600">
            Registra un ingreso o egreso. El saldo se actualiza automáticamente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Cuenta *</Label>
            <Select
              value={cuentaId ? String(cuentaId) : ""}
              onValueChange={(v) => setCuentaId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona una cuenta..." />
              </SelectTrigger>
              <SelectContent className="z-[100] bg-white text-slate-900 [&_*]:text-slate-900">
                {cuentas
                  .filter((c) => c.activo)
                  .map((c) => (
                    <SelectItem key={c.cuentaId} value={String(c.cuentaId)}>
                      {c.nombreCuenta} · {c.banco} · {MONEDA_LABEL[getMoneda(c)]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {cuentaSeleccionada && (
              <p className="text-xs text-slate-500">
                Saldo actual:{" "}
                <span className="font-semibold text-slate-900">
                  {formatSaldo(
                    cuentaSeleccionada.saldo_actual,
                    getMoneda(cuentaSeleccionada)
                  )}
                </span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTipo("ingreso")}
              className={`flex items-center justify-center gap-2 rounded-md border-2 px-4 py-3 text-sm font-medium transition-colors ${
                tipo === "ingreso"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-input hover:bg-muted"
              }`}
            >
              <ArrowDownCircle className="h-4 w-4" />
              Ingreso
            </button>
            <button
              type="button"
              onClick={() => setTipo("egreso")}
              className={`flex items-center justify-center gap-2 rounded-md border-2 px-4 py-3 text-sm font-medium transition-colors ${
                tipo === "egreso"
                  ? "border-red-500 bg-red-50 text-red-700"
                  : "border-input hover:bg-muted"
              }`}
            >
              <ArrowUpCircle className="h-4 w-4" />
              Egreso
            </button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="monto">Monto *</Label>
            <Input
              id="monto"
              type="number"
              step="0.01"
              min="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo / referencia</Label>
            <Textarea
              id="motivo"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: Saldo inicial, desembolso crédito 123..."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={crear.isPending || !cuentaId || !monto}
            >
              {crear.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Registrar movimiento"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------
// Dialog: ver movimientos de una cuenta (con filtros)
// ----------------------------------------------------------------

function MovimientosListDialog({
  open,
  cuenta,
  onClose,
  onAgregar,
}: {
  open: boolean;
  cuenta: CuentaEmpresa | null;
  onClose: () => void;
  onAgregar: () => void;
}) {
  const [tipoFilter, setTipoFilter] = useState<TipoMovimientoCuenta | "todos">(
    "todos"
  );
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [searchMotivo, setSearchMotivo] = useState<string>("");

  // Reset filtros cuando cambia la cuenta o se abre
  useEffect(() => {
    if (open) {
      setTipoFilter("todos");
      setDesde("");
      setHasta("");
      setSearchMotivo("");
    }
  }, [open, cuenta?.cuentaId]);

  const { data: movimientos = [], isLoading } = useMovimientosCuenta(
    open ? cuenta?.cuentaId ?? null : null,
    {
      tipo: tipoFilter === "todos" ? undefined : tipoFilter,
      desde: desde || undefined,
      // hasta inclusive: lo desplazo a fin de día
      hasta: hasta ? `${hasta}T23:59:59.999Z` : undefined,
      orden: "desc",
    }
  );

  // Filtro client-side por motivo (instant)
  const filtrados = useMemo(() => {
    const q = searchMotivo.trim().toLowerCase();
    if (!q) return movimientos;
    return movimientos.filter((m) =>
      (m.motivo ?? "").toLowerCase().includes(q)
    );
  }, [movimientos, searchMotivo]);

  // Totales del listado actual (solo lo que se está mostrando)
  const totales = useMemo(() => {
    let ingresos = 0;
    let egresos = 0;
    for (const m of filtrados) {
      const n = Number(m.monto) || 0;
      if (m.tipo === "ingreso") ingresos += n;
      else egresos += n;
    }
    return { ingresos, egresos, neto: ingresos - egresos };
  }, [filtrados]);

  if (!cuenta) return null;
  const moneda = getMoneda(cuenta);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-[min(95vw,1400px)] w-[95vw] h-[90vh] max-h-[90vh] flex flex-col bg-white text-slate-900 p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-slate-900 flex items-center gap-2">
                <History className="h-5 w-5 text-indigo-600" />
                Movimientos de {cuenta.nombreCuenta}
              </DialogTitle>
              <DialogDescription className="text-slate-600 mt-1">
                {cuenta.banco} · <span className="font-mono">{cuenta.numeroCuenta}</span>{" "}
                · {MONEDA_LABEL[moneda]} · Saldo actual{" "}
                <span className="font-semibold text-slate-900">
                  {formatSaldo(cuenta.saldo_actual, moneda)}
                </span>
              </DialogDescription>
            </div>
            <Button
              size="sm"
              onClick={onAgregar}
              className="shrink-0"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nuevo movimiento
            </Button>
          </div>
        </DialogHeader>

        {/* Filtros */}
        <div className="px-6 py-4 border-b bg-slate-50/50">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Tipo</Label>
              <Select
                value={tipoFilter}
                onValueChange={(v) => setTipoFilter(v as any)}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100] bg-white text-slate-900 [&_*]:text-slate-900">
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="ingreso">Solo ingresos</SelectItem>
                  <SelectItem value="egreso">Solo egresos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desde" className="text-xs text-slate-600">Desde</Label>
              <Input
                id="desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="bg-white text-slate-900"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hasta" className="text-xs text-slate-600">Hasta</Label>
              <Input
                id="hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="bg-white text-slate-900"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="motivo-filter" className="text-xs text-slate-600">
                Buscar en motivo
              </Label>
              <Input
                id="motivo-filter"
                placeholder="Ej: desembolso..."
                value={searchMotivo}
                onChange={(e) => setSearchMotivo(e.target.value)}
                className="bg-white text-slate-900 placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* Resumen del rango filtrado */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <ResumenMini
              label="Ingresos"
              valor={formatSaldo(totales.ingresos, moneda)}
              color="text-emerald-600"
            />
            <ResumenMini
              label="Egresos"
              valor={formatSaldo(totales.egresos, moneda)}
              color="text-red-600"
            />
            <ResumenMini
              label="Neto"
              valor={formatSaldo(totales.neto, moneda)}
              color={totales.neto >= 0 ? "text-slate-900" : "text-red-600"}
            />
          </div>
        </div>

        {/* Listado */}
        <div className="flex-1 min-h-0 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Cargando movimientos...
            </div>
          ) : filtrados.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <History className="h-10 w-10 mx-auto mb-2 text-slate-300" />
              <p>No hay movimientos con los filtros actuales.</p>
            </div>
          ) : (
            <Table className="border-separate border-spacing-0">
              <TableHeader className="sticky top-0 z-10 bg-slate-50">
                <TableRow className="hover:bg-slate-50">
                  <TableHead className="text-slate-700 font-semibold w-[180px] min-w-[180px] bg-slate-50 border-b">
                    Fecha
                  </TableHead>
                  <TableHead className="text-slate-700 font-semibold w-[120px] min-w-[120px] bg-slate-50 border-b">
                    Tipo
                  </TableHead>
                  <TableHead className="text-right text-slate-700 font-semibold w-[140px] min-w-[140px] bg-slate-50 border-b">
                    Monto
                  </TableHead>
                  <TableHead className="text-right text-slate-700 font-semibold w-[160px] min-w-[160px] bg-slate-50 border-b">
                    Saldo después
                  </TableHead>
                  <TableHead className="text-slate-700 font-semibold min-w-[200px] bg-slate-50 border-b">
                    Motivo
                  </TableHead>
                  <TableHead className="text-slate-700 font-semibold w-[100px] min-w-[100px] bg-slate-50 border-b">
                    #
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((m) => (
                  <MovimientoRow key={m.movimiento_id} mov={m} moneda={moneda} />
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-slate-50/50">
          <div className="flex items-center justify-between w-full">
            <p className="text-xs text-slate-500">
              {filtrados.length} {filtrados.length === 1 ? "movimiento" : "movimientos"} encontrados
            </p>
            <Button variant="outline" onClick={onClose}>
              <X className="mr-2 h-4 w-4" />
              Cerrar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResumenMini({
  label,
  valor,
  color,
}: {
  label: string;
  valor: string;
  color: string;
}) {
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
        {label}
      </p>
      <p className={`text-sm font-bold tabular-nums ${color}`}>{valor}</p>
    </div>
  );
}

function MovimientoRow({
  mov,
  moneda,
}: {
  mov: MovimientoCuentaEmpresa;
  moneda: MonedaCuenta;
}) {
  const fecha = new Date(mov.created_at);
  const fechaStr = fecha.toLocaleString("es-GT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Guatemala",
  });

  const isIngreso = mov.tipo === "ingreso";
  return (
    <TableRow className="text-slate-800 hover:bg-slate-50">
      <TableCell className="text-xs text-slate-700 whitespace-nowrap">
        {fechaStr}
      </TableCell>
      <TableCell>
        <Badge
          className={
            isIngreso
              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0"
              : "bg-red-100 text-red-700 hover:bg-red-100 border-0"
          }
        >
          {isIngreso ? (
            <ArrowDownCircle className="mr-1 h-3 w-3" />
          ) : (
            <ArrowUpCircle className="mr-1 h-3 w-3" />
          )}
          {isIngreso ? "Ingreso" : "Egreso"}
        </Badge>
      </TableCell>
      <TableCell
        className={`text-right font-semibold tabular-nums whitespace-nowrap ${
          isIngreso ? "text-emerald-700" : "text-red-700"
        }`}
      >
        {isIngreso ? "+" : "−"} {formatSaldo(mov.monto, moneda)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-slate-600 whitespace-nowrap">
        {formatSaldo(mov.saldo_post, moneda)}
      </TableCell>
      <TableCell
        className="text-sm text-slate-700 max-w-[400px] truncate"
        title={mov.motivo ?? undefined}
      >
        {mov.motivo || <span className="text-slate-400 italic">sin motivo</span>}
      </TableCell>
      <TableCell className="text-xs font-mono text-slate-400">
        #{mov.movimiento_id}
      </TableCell>
    </TableRow>
  );
}
