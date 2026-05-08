import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Combobox, Transition } from "@headlessui/react";
import {
  Check,
  ChevronsUpDown,
  CreditCard,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
  useActualizarCuentaExtra,
  useCrearCuentaExtra,
  useCuentasExtra,
  useEliminarCuentaExtra,
} from "../hooks/cuentasExtraInversionista";
import { useBancos } from "../hooks/bancos";
import {
  getInvestors,
  type Banco,
  type CuentaExtraInversionista,
  type InvestorResponse,
  type MonedaCuenta,
  type TipoCuentaInversionista,
} from "../services/services";
import { useIsMobile } from "../hooks/useIsMobile";

const TIPO_CUENTA_OPCIONES: TipoCuentaInversionista[] = [
  "AHORRO",
  "AHORRO Q",
  "AHORROS",
  "AHORRO $",
  "MONETARIA",
  "MONETARIA Q",
  "MONETARIA $",
  "Capital",
];

const MONEDA_LABEL: Record<MonedaCuenta, string> = {
  quetzales: "GTQ",
  dolares: "USD",
};

const ALL = "__all__";

export function CuentasExtraInversionistaManager() {
  const isMobile = useIsMobile();

  // Filtros server-side
  const [inversionistaId, setInversionistaId] = useState<number | undefined>();
  const [bancoId, setBancoId] = useState<number | undefined>();
  const [tipoCuenta, setTipoCuenta] = useState<TipoCuentaInversionista | undefined>();
  const [moneda, setMoneda] = useState<MonedaCuenta | undefined>();
  // Texto: filtramos client-side para no recargar por cada tecla
  const [search, setSearch] = useState("");

  const { data: cuentas = [], isLoading } = useCuentasExtra({
    inversionistaId,
    bancoId,
    tipoCuenta,
    moneda,
  });

  // Catálogos
  const { bancos, loading: loadingBancos, loadBancos } = useBancos();
  useEffect(() => {
    if (bancos.length === 0) loadBancos();
  }, [bancos.length, loadBancos]);

  const { data: investors = [] } = useQuery<InvestorResponse[]>({
    queryKey: ["investors"],
    queryFn: getInvestors,
    staleTime: 5 * 60 * 1000,
  });

  // Mapas para mostrar nombre/banco en la tabla
  const investorById = useMemo(() => {
    const map = new Map<number, InvestorResponse>();
    for (const i of investors) map.set(i.inversionista_id, i);
    return map;
  }, [investors]);

  const bancoById = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of bancos) map.set(b.banco_id, b.nombre);
    return map;
  }, [bancos]);

  // Búsqueda libre (numero_cuenta, motivo, nombre inversionista, nombre banco)
  const cuentasFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cuentas;
    return cuentas.filter((c) => {
      const inv = investorById.get(c.inversionista_id)?.nombre ?? "";
      const bn = bancoById.get(c.banco_id) ?? "";
      return (
        c.numero_cuenta.toLowerCase().includes(q) ||
        c.motivo_cuenta.toLowerCase().includes(q) ||
        inv.toLowerCase().includes(q) ||
        bn.toLowerCase().includes(q)
      );
    });
  }, [cuentas, search, investorById, bancoById]);

  const [cuentaDialog, setCuentaDialog] = useState<{
    open: boolean;
    cuenta: CuentaExtraInversionista | null;
  }>({ open: false, cuenta: null });

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    cuenta: CuentaExtraInversionista | null;
  }>({ open: false, cuenta: null });

  const eliminar = useEliminarCuentaExtra();

  const limpiarFiltros = () => {
    setInversionistaId(undefined);
    setBancoId(undefined);
    setTipoCuenta(undefined);
    setMoneda(undefined);
    setSearch("");
  };

  return (
    <div className="space-y-6 mx-auto w-full max-w-7xl text-slate-900">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2 text-slate-900">
            <CreditCard className="h-6 w-6 text-blue-600" />
            Cuentas extra de inversionistas
          </h1>
          <p className="text-sm text-slate-500">
            Gestiona cuentas bancarias adicionales asociadas a cada inversionista.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setCuentaDialog({ open: true, cuenta: null })}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva cuenta
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="bg-white shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Inversionista</Label>
              <InvestorCombobox
                value={inversionistaId ?? null}
                onChange={(v) => setInversionistaId(v ?? undefined)}
                investors={investors}
                placeholder="Todos"
                allowClear
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Banco</Label>
              <BancoCombobox
                value={bancoId ?? null}
                onChange={(v) => setBancoId(v ?? undefined)}
                bancos={bancos}
                disabled={loadingBancos}
                placeholder={loadingBancos ? "Cargando..." : "Todos"}
                allowClear
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Tipo de cuenta</Label>
              <Select
                value={tipoCuenta ?? ALL}
                onValueChange={(v) =>
                  setTipoCuenta(v === ALL ? undefined : (v as TipoCuentaInversionista))
                }
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent className="z-[100] bg-white text-slate-900 [&_*]:text-slate-900">
                  <SelectItem value={ALL}>Todos</SelectItem>
                  {TIPO_CUENTA_OPCIONES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Moneda</Label>
              <Select
                value={moneda ?? ALL}
                onValueChange={(v) =>
                  setMoneda(v === ALL ? undefined : (v as MonedaCuenta))
                }
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent className="z-[100] bg-white text-slate-900 [&_*]:text-slate-900">
                  <SelectItem value={ALL}>Todas</SelectItem>
                  <SelectItem value="quetzales">GTQ — Quetzales</SelectItem>
                  <SelectItem value="dolares">USD — Dólares</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Buscar por inversionista, banco, número o motivo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white text-slate-900 placeholder:text-slate-400"
              />
            </div>
            <Button variant="outline" size="sm" onClick={limpiarFiltros}>
              <X className="mr-2 h-4 w-4" />
              Limpiar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

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
            <CuentaExtraCard
              key={cuenta.cuenta_extra_id}
              cuenta={cuenta}
              inversionistaNombre={
                investorById.get(cuenta.inversionista_id)?.nombre ?? `#${cuenta.inversionista_id}`
              }
              bancoNombre={bancoById.get(cuenta.banco_id) ?? `#${cuenta.banco_id}`}
              onEdit={() => setCuentaDialog({ open: true, cuenta })}
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
                  <TableHead className="text-slate-700 font-semibold">Inversionista</TableHead>
                  <TableHead className="text-slate-700 font-semibold">Banco</TableHead>
                  <TableHead className="text-slate-700 font-semibold">Número</TableHead>
                  <TableHead className="text-slate-700 font-semibold">Tipo</TableHead>
                  <TableHead className="text-slate-700 font-semibold">Moneda</TableHead>
                  <TableHead className="text-slate-700 font-semibold">Motivo</TableHead>
                  <TableHead className="text-right text-slate-700 font-semibold">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cuentasFiltradas.map((cuenta) => (
                  <TableRow key={cuenta.cuenta_extra_id} className="text-slate-800">
                    <TableCell className="font-medium text-slate-900">
                      {investorById.get(cuenta.inversionista_id)?.nombre ?? `#${cuenta.inversionista_id}`}
                    </TableCell>
                    <TableCell>{bancoById.get(cuenta.banco_id) ?? `#${cuenta.banco_id}`}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {cuenta.numero_cuenta}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-slate-700 border-slate-300">
                        {cuenta.tipo_cuenta}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-slate-700 border-slate-300">
                        {MONEDA_LABEL[cuenta.moneda]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-sm text-slate-700" title={cuenta.motivo_cuenta}>
                      {cuenta.motivo_cuenta}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Editar"
                          className="text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                          onClick={() => setCuentaDialog({ open: true, cuenta })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Eliminar"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleteDialog({ open: true, cuenta })}
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

      {/* Dialog crear/editar */}
      <CuentaExtraDialog
        open={cuentaDialog.open}
        cuenta={cuentaDialog.cuenta}
        investors={investors}
        onClose={() => setCuentaDialog({ open: false, cuenta: null })}
      />

      {/* Confirmación delete */}
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) =>
          !open && setDeleteDialog({ open: false, cuenta: null })
        }
      >
        <AlertDialogContent className="bg-white text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">
              Eliminar cuenta extra
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600">
              Se eliminará la cuenta{" "}
              <b>{deleteDialog.cuenta?.numero_cuenta}</b> (
              {deleteDialog.cuenta && (bancoById.get(deleteDialog.cuenta.banco_id) ?? `#${deleteDialog.cuenta.banco_id}`)}
              ) del inversionista{" "}
              <b>
                {deleteDialog.cuenta &&
                  (investorById.get(deleteDialog.cuenta.inversionista_id)?.nombre ??
                    `#${deleteDialog.cuenta.inversionista_id}`)}
              </b>
              . Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteDialog.cuenta) return;
                eliminar.mutate(deleteDialog.cuenta.cuenta_extra_id, {
                  onSettled: () =>
                    setDeleteDialog({ open: false, cuenta: null }),
                });
              }}
            >
              {eliminar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ----------------------------------------------------------------
// Card mobile
// ----------------------------------------------------------------

function CuentaExtraCard({
  cuenta,
  inversionistaNombre,
  bancoNombre,
  onEdit,
  onDelete,
}: {
  cuenta: CuentaExtraInversionista;
  inversionistaNombre: string;
  bancoNombre: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="overflow-hidden bg-white shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base text-slate-900">{inversionistaNombre}</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              {bancoNombre} · <span className="font-mono">{cuenta.numero_cuenta}</span>
            </p>
          </div>
          <Badge variant="outline" className="text-slate-700 border-slate-300">
            {MONEDA_LABEL[cuenta.moneda]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-slate-700 border-slate-300">
            {cuenta.tipo_cuenta}
          </Badge>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">Motivo</p>
          <p className="text-sm text-slate-700">{cuenta.motivo_cuenta}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Button size="sm" variant="outline" onClick={onDelete} title="Eliminar">
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------
// Dialog crear / editar
// ----------------------------------------------------------------

function CuentaExtraDialog({
  open,
  cuenta,
  investors,
  onClose,
}: {
  open: boolean;
  cuenta: CuentaExtraInversionista | null;
  investors: InvestorResponse[];
  onClose: () => void;
}) {
  const isEdit = !!cuenta;

  const { bancos, loading: loadingBancos, loadBancos } = useBancos();
  useEffect(() => {
    if (open && bancos.length === 0) loadBancos();
  }, [open, bancos.length, loadBancos]);

  const [form, setForm] = useState({
    inversionistaId: "" as string,
    bancoId: "" as string,
    tipoCuenta: "MONETARIA" as TipoCuentaInversionista,
    numeroCuenta: "",
    motivoCuenta: "",
    moneda: "quetzales" as MonedaCuenta,
  });

  useEffect(() => {
    if (!open) return;
    if (cuenta) {
      setForm({
        inversionistaId: String(cuenta.inversionista_id),
        bancoId: String(cuenta.banco_id),
        tipoCuenta: cuenta.tipo_cuenta,
        numeroCuenta: cuenta.numero_cuenta,
        motivoCuenta: cuenta.motivo_cuenta,
        moneda: cuenta.moneda,
      });
    } else {
      setForm({
        inversionistaId: "",
        bancoId: "",
        tipoCuenta: "MONETARIA",
        numeroCuenta: "",
        motivoCuenta: "",
        moneda: "quetzales",
      });
    }
  }, [open, cuenta]);

  const crear = useCrearCuentaExtra();
  const actualizar = useActualizarCuentaExtra();
  const isPending = crear.isPending || actualizar.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const inversionistaId = Number(form.inversionistaId);
    const bancoId = Number(form.bancoId);
    const numeroCuenta = form.numeroCuenta.trim();
    const motivoCuenta = form.motivoCuenta.trim();

    if (!inversionistaId || !bancoId || !numeroCuenta || !motivoCuenta) return;

    if (isEdit && cuenta) {
      actualizar.mutate(
        {
          cuentaExtraId: cuenta.cuenta_extra_id,
          payload: {
            bancoId,
            tipoCuenta: form.tipoCuenta,
            numeroCuenta,
            motivoCuenta,
            moneda: form.moneda,
          },
        },
        { onSuccess: (res) => res.success && onClose() }
      );
    } else {
      crear.mutate(
        {
          inversionistaId,
          bancoId,
          tipoCuenta: form.tipoCuenta,
          numeroCuenta,
          motivoCuenta,
          moneda: form.moneda,
        },
        { onSuccess: (res) => res.success && onClose() }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-900">
            {isEdit ? "Editar cuenta extra" : "Nueva cuenta extra"}
          </DialogTitle>
          <DialogDescription className="text-slate-600">
            {isEdit
              ? "Actualiza los datos de la cuenta extra del inversionista."
              : "Agrega una cuenta bancaria adicional asociada a un inversionista."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inversionista">Inversionista *</Label>
            <InvestorCombobox
              value={form.inversionistaId ? Number(form.inversionistaId) : null}
              onChange={(v) =>
                setForm((f) => ({ ...f, inversionistaId: v ? String(v) : "" }))
              }
              investors={investors}
              placeholder="Buscar inversionista..."
              disabled={isEdit}
            />
            {isEdit && (
              <p className="text-xs text-slate-500">
                El inversionista no se puede cambiar una vez creada la cuenta.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="banco">Banco *</Label>
              <BancoCombobox
                value={form.bancoId ? Number(form.bancoId) : null}
                onChange={(v) =>
                  setForm((f) => ({ ...f, bancoId: v ? String(v) : "" }))
                }
                bancos={bancos}
                disabled={loadingBancos}
                placeholder={loadingBancos ? "Cargando..." : "Buscar banco..."}
              />
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tipoCuenta">Tipo de cuenta *</Label>
              <Select
                value={form.tipoCuenta}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, tipoCuenta: v as TipoCuentaInversionista }))
                }
              >
                <SelectTrigger id="tipoCuenta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100] bg-white text-slate-900 [&_*]:text-slate-900">
                  {TIPO_CUENTA_OPCIONES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                maxLength={100}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="motivoCuenta">Motivo de la cuenta *</Label>
            <Input
              id="motivoCuenta"
              value={form.motivoCuenta}
              onChange={(e) =>
                setForm((f) => ({ ...f, motivoCuenta: e.target.value }))
              }
              placeholder="Ej: Pagos en dólares, cuenta secundaria, ahorro..."
              required
              maxLength={255}
            />
          </div>

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

// ----------------------------------------------------------------
// Combobox de inversionistas (mismo patrón que InvestorsList.tsx)
// ----------------------------------------------------------------

function InvestorCombobox({
  value,
  onChange,
  investors,
  placeholder,
  disabled,
  allowClear,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  investors: InvestorResponse[];
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const [query, setQuery] = useState("");

  const selected = value
    ? investors.find((i) => i.inversionista_id === value) ?? null
    : null;

  const filtered =
    query === ""
      ? investors
      : investors.filter((i) =>
          i.nombre.toLowerCase().includes(query.toLowerCase())
        );

  return (
    <Combobox
      value={value ?? 0}
      onChange={(v: number) => {
        onChange(v ? Number(v) : null);
        setQuery("");
      }}
      disabled={disabled}
    >
      <div className="relative">
        <div className="relative w-full">
          <Combobox.Input
            className="w-full rounded-md border border-slate-200 bg-white pl-3 pr-16 py-2 h-10 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-400 focus:border-blue-500 focus:outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70 transition-all"
            displayValue={(id: number) =>
              !id ? "" : investors.find((i) => i.inversionista_id === Number(id))?.nombre ?? ""
            }
            onChange={(e) => setQuery(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder={placeholder ?? "Buscar inversionista..."}
            disabled={disabled}
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-1">
            {allowClear && selected && !disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                  setQuery("");
                }}
                className="rounded p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                title="Limpiar"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <Combobox.Button className="flex items-center pr-1">
              <ChevronsUpDown className="h-4 w-4 text-slate-400 hover:text-slate-600 transition-colors" />
            </Combobox.Button>
          </div>
        </div>
        <Transition
          as={Fragment as any}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          afterLeave={() => setQuery("")}
        >
          <Combobox.Options className="absolute z-[100] mt-2 w-full max-h-60 overflow-auto rounded-xl bg-white py-2 shadow-2xl border-2 border-blue-200 focus:outline-none">
            {filtered.length === 0 ? (
              <div className="relative cursor-default select-none py-4 px-4 text-center text-slate-500 text-sm">
                No se encontró inversionista
              </div>
            ) : (
              filtered.map((opt) => (
                <Combobox.Option
                  key={opt.inversionista_id}
                  value={opt.inversionista_id}
                  className={({ active, selected }) =>
                    `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors ${
                      active
                        ? "bg-blue-50 text-blue-900"
                        : selected
                        ? "bg-blue-50 text-blue-900"
                        : "bg-white text-slate-700 hover:bg-slate-50"
                    }`
                  }
                >
                  {({ selected }) => (
                    <>
                      <span
                        className={`block truncate ${
                          selected ? "font-bold" : "font-medium"
                        }`}
                      >
                        {opt.nombre}
                      </span>
                      {selected && (
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-emerald-600">
                          <Check className="h-5 w-5" />
                        </span>
                      )}
                    </>
                  )}
                </Combobox.Option>
              ))
            )}
          </Combobox.Options>
        </Transition>
      </div>
    </Combobox>
  );
}

// ----------------------------------------------------------------
// Combobox de bancos (mismo patrón que PagoForm.tsx)
// ----------------------------------------------------------------

function BancoCombobox({
  value,
  onChange,
  bancos,
  placeholder,
  disabled,
  allowClear,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  bancos: Banco[];
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const [query, setQuery] = useState("");

  const selected = value
    ? bancos.find((b) => b.banco_id === value) ?? null
    : null;

  const filtered =
    query === ""
      ? bancos
      : bancos.filter((b) =>
          b.nombre.toLowerCase().includes(query.toLowerCase())
        );

  return (
    <Combobox
      value={value ?? 0}
      onChange={(v: number) => {
        onChange(v ? Number(v) : null);
        setQuery("");
      }}
      disabled={disabled}
    >
      <div className="relative">
        <div className="relative w-full">
          <Combobox.Input
            className="w-full rounded-md border border-slate-200 bg-white pl-3 pr-16 py-2 h-10 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-blue-400 focus:border-blue-500 focus:outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70 transition-all"
            displayValue={(id: number) =>
              !id ? "" : bancos.find((b) => b.banco_id === Number(id))?.nombre ?? ""
            }
            onChange={(e) => setQuery(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder={placeholder ?? "Buscar banco..."}
            disabled={disabled}
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-1">
            {allowClear && selected && !disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                  setQuery("");
                }}
                className="rounded p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                title="Limpiar"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <Combobox.Button className="flex items-center pr-1">
              <ChevronsUpDown className="h-4 w-4 text-slate-400 hover:text-slate-600 transition-colors" />
            </Combobox.Button>
          </div>
        </div>
        <Transition
          as={Fragment as any}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          afterLeave={() => setQuery("")}
        >
          <Combobox.Options className="absolute z-[100] mt-2 w-full max-h-60 overflow-auto rounded-xl bg-white py-2 shadow-2xl border-2 border-blue-200 focus:outline-none">
            {filtered.length === 0 ? (
              <div className="relative cursor-default select-none py-4 px-4 text-center text-slate-500 text-sm">
                No se encontró banco
              </div>
            ) : (
              filtered.map((opt) => (
                <Combobox.Option
                  key={opt.banco_id}
                  value={opt.banco_id}
                  className={({ active, selected }) =>
                    `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors ${
                      active
                        ? "bg-blue-50 text-blue-900"
                        : selected
                        ? "bg-blue-50 text-blue-900"
                        : "bg-white text-slate-700 hover:bg-slate-50"
                    }`
                  }
                >
                  {({ selected }) => (
                    <>
                      <span
                        className={`block truncate ${
                          selected ? "font-bold" : "font-medium"
                        }`}
                      >
                        {opt.nombre}
                      </span>
                      {selected && (
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-emerald-600">
                          <Check className="h-5 w-5" />
                        </span>
                      )}
                    </>
                  )}
                </Combobox.Option>
              ))
            )}
          </Combobox.Options>
        </Transition>
      </div>
    </Combobox>
  );
}
