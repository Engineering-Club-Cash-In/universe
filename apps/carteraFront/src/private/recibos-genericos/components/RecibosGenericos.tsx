/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useFormik } from "formik";
import { toast } from "sonner";
import {
  Receipt,
  Plus,
  Trash2,
  Loader2,
  FileText,
  X,
  DollarSign,
  Calendar,
  User,
  Download,
  Pencil,
  Search,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DatePickerMUI } from "@/private/cartera/components/calendar";
import {
  useRecibosGenericos,
  useCreateReciboGenerico,
  useUpdateReciboGenerico,
  useDeleteReciboGenerico,
  useReciboGenericoPdf,
} from "../hooks/useRecibosGenericos";
import type { ReciboGenerico } from "../services/services";

// --- Utilidades ---
const formatCurrency = (val?: string | number | null) =>
  val == null || isNaN(Number(val))
    ? "--"
    : Number(val).toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
        minimumFractionDigits: 2,
      });

const formatDate = (d?: string) => {
  if (!d) return "--";
  const date = new Date(d);
  return date.toLocaleDateString("es-GT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function RecibosGenericos() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecibo, setEditingRecibo] = useState<ReciboGenerico | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // Filtros de fecha
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [fechaDesdeFiltro, setFechaDesdeFiltro] = useState("");
  const [fechaHastaFiltro, setFechaHastaFiltro] = useState("");

  // Hooks
  const { data: recibos, isLoading, refetch } = useRecibosGenericos({
    fecha_desde: fechaDesdeFiltro || undefined,
    fecha_hasta: fechaHastaFiltro || undefined,
  });
  const { mutate: crear, isPending: isCreando } = useCreateReciboGenerico();
  const { mutate: actualizar, isPending: isActualizando } = useUpdateReciboGenerico();
  const { mutate: eliminar } = useDeleteReciboGenerico();
  const { mutate: descargarPdf, isPending: isDescargando } = useReciboGenericoPdf();

  const isSaving = isCreando || isActualizando;

  // Formik
  const formik = useFormik({
    initialValues: {
      nombre: "",
      observaciones: "",
      montos: [{ concepto: "", monto: "" }] as { concepto: string; monto: string }[],
    },
    enableReinitialize: true,
    validate: (values) => {
      const errors: any = {};
      if (!values.nombre.trim()) errors.nombre = "El nombre es requerido";
      if (values.montos.length === 0) errors.montos = "Debe agregar al menos un monto";
      const montosErrors: any[] = [];
      values.montos.forEach((m, i) => {
        const err: any = {};
        if (!m.concepto.trim()) err.concepto = "Requerido";
        if (!m.monto || Number(m.monto) <= 0) err.monto = "Debe ser mayor a 0";
        if (Object.keys(err).length > 0) montosErrors[i] = err;
      });
      if (montosErrors.length > 0) errors.montosDetail = montosErrors;
      return errors;
    },
    onSubmit: (values, { resetForm }) => {
      const payload = {
        nombre: values.nombre.trim(),
        observaciones: values.observaciones.trim() || undefined,
        montos: values.montos.map((m) => ({
          concepto: m.concepto.trim(),
          monto: Number(m.monto).toFixed(2),
        })),
      };

      if (editingRecibo) {
        actualizar(
          { id: editingRecibo.id, payload },
          {
            onSuccess: () => {
              toast.success("Recibo actualizado");
              resetForm();
              setEditingRecibo(null);
              setModalOpen(false);
              refetch();
            },
            onError: (err: any) => {
              toast.error(err?.response?.data?.message || "Error al actualizar");
            },
          }
        );
      } else {
        crear(payload, {
          onSuccess: () => {
            toast.success("Recibo creado exitosamente");
            resetForm();
            setModalOpen(false);
            refetch();
          },
          onError: (err: any) => {
            toast.error(err?.response?.data?.message || "Error al crear recibo");
          },
        });
      }
    },
  });

  const openCreate = () => {
    setEditingRecibo(null);
    formik.resetForm({
      values: { nombre: "", observaciones: "", montos: [{ concepto: "", monto: "" }] },
    });
    setModalOpen(true);
  };

  const openEdit = (recibo: ReciboGenerico) => {
    setEditingRecibo(recibo);
    formik.resetForm({
      values: {
        nombre: recibo.nombre,
        observaciones: recibo.observaciones || "",
        montos: recibo.montos.map((m) => ({ concepto: m.concepto, monto: m.monto })),
      },
    });
    setModalOpen(true);
  };

  const handleDelete = (id: number) => {
    eliminar(id, {
      onSuccess: () => {
        toast.success("Recibo eliminado");
        setConfirmDelete(null);
        refetch();
      },
      onError: (err: any) => {
        toast.error(err?.response?.data?.message || "Error al eliminar");
        setConfirmDelete(null);
      },
    });
  };

  const handlePdf = (id: number) => {
    descargarPdf(id, {
      onSuccess: (data) => {
        window.open(data.pdfUrl, "_blank");
      },
      onError: (err: any) => {
        toast.error(err?.response?.data?.message || "Error al generar PDF");
      },
    });
  };

  const totalMontos = formik.values.montos.reduce(
    (sum, m) => sum + (Number(m.monto) || 0),
    0
  );

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
      <div className="bg-blue-50 rounded-xl shadow-md p-5 w-full max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-bold text-blue-900 flex items-center gap-2">
          <Receipt className="w-6 h-6 text-blue-700" />
          Recibos Genéricos
        </h2>
        <Button
          onClick={openCreate}
          className="bg-blue-700 hover:bg-blue-800 text-white font-bold gap-2"
        >
          <Plus className="h-4 w-4" /> Nuevo Recibo
        </Button>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-col sm:flex-row items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Desde</label>
            <DatePickerMUI
              value={fechaDesde}
              onChange={(v) => setFechaDesde(v)}
              disableFuture={false}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Hasta</label>
            <DatePickerMUI
              value={fechaHasta}
              onChange={(v) => setFechaHasta(v)}
              disableFuture={false}
            />
          </div>
          <Button
            onClick={() => {
              setFechaDesdeFiltro(fechaDesde);
              setFechaHastaFiltro(fechaHasta);
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-2"
          >
            <Search className="h-4 w-4" /> Buscar
          </Button>
          {(fechaDesdeFiltro || fechaHastaFiltro) && (
            <Button
              variant="outline"
              onClick={() => {
                setFechaDesde("");
                setFechaHasta("");
                setFechaDesdeFiltro("");
                setFechaHastaFiltro("");
              }}
              className="text-gray-600 gap-2"
            >
              <X className="h-4 w-4" /> Limpiar
            </Button>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : !recibos || recibos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <FileText className="h-12 w-12 mb-3" />
            <p className="font-medium">No hay recibos</p>
            <p className="text-sm">Crea uno nuevo para empezar</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">ID</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Nombre</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Fecha</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Observaciones</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700">Total</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-700">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {recibos.map((r) => {
                  const total = r.montos.reduce((s, m) => s + Number(m.monto), 0);
                  return (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-blue-50/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-500">#{r.id}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-gray-400" />
                          {r.nombre}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-gray-400" />
                          {formatDate(r.fecha)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                        {r.observaciones || "--"}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-green-700">
                        <div className="flex items-center justify-end gap-1">
                          <DollarSign className="h-4 w-4" />
                          {formatCurrency(total)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(r)}
                            className="p-2 rounded-lg hover:bg-blue-100 text-blue-600 transition-colors"
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handlePdf(r.id)}
                            disabled={isDescargando}
                            className="p-2 rounded-lg hover:bg-green-100 text-green-600 transition-colors"
                            title="Descargar PDF"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setConfirmDelete(r.id)}
                            className="p-2 rounded-lg hover:bg-red-100 text-red-500 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Crear/Editar */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="bg-white rounded-2xl shadow-2xl border border-blue-100 w-full max-w-lg mx-4 flex flex-col"
            style={{ maxHeight: "90vh" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
              <h2 className="text-lg font-bold text-blue-800 flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                {editingRecibo ? "Editar Recibo" : "Nuevo Recibo"}
              </h2>
              <button
                onClick={() => { setModalOpen(false); setEditingRecibo(null); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={formik.handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Nombre */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Nombre *</label>
                <Input
                  name="nombre"
                  placeholder="Nombre de quien sale el recibo"
                  value={formik.values.nombre}
                  onChange={formik.handleChange}
                  className="bg-white border-blue-200 text-gray-900 font-medium"
                />
                {formik.errors.nombre && formik.touched.nombre && (
                  <span className="text-xs text-red-500">{formik.errors.nombre as string}</span>
                )}
              </div>

              {/* Observaciones */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Observaciones</label>
                <textarea
                  name="observaciones"
                  placeholder="Opcional"
                  value={formik.values.observaciones}
                  onChange={formik.handleChange}
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 bg-white border-blue-200 text-gray-900 font-medium text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              {/* Montos */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-gray-700">Detalle de Montos</label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-blue-700 border-blue-300 hover:bg-blue-50 gap-1"
                    onClick={() =>
                      formik.setFieldValue("montos", [
                        ...formik.values.montos,
                        { concepto: "", monto: "" },
                      ])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Agregar
                  </Button>
                </div>

                {formik.values.montos.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <div className="flex-1">
                      <Input
                        placeholder="Concepto"
                        value={item.concepto}
                        onChange={(e) =>
                          formik.setFieldValue(`montos.${idx}.concepto`, e.target.value)
                        }
                        className="bg-white border-gray-200 text-sm text-gray-900 font-medium"
                      />
                    </div>
                    <div className="w-32">
                      <Input
                        type="number"
                        placeholder="0.00"
                        step="any"
                        min={0}
                        value={item.monto}
                        onChange={(e) =>
                          formik.setFieldValue(`montos.${idx}.monto`, e.target.value)
                        }
                        className="bg-white border-gray-200 text-sm text-gray-900 font-medium text-right"
                      />
                    </div>
                    {formik.values.montos.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = formik.values.montos.filter((_, i) => i !== idx);
                          formik.setFieldValue("montos", updated);
                        }}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors mt-0.5"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}

                {/* Total */}
                <div className="flex justify-end items-center gap-2 pt-2 border-t border-gray-100">
                  <span className="text-sm font-semibold text-gray-600">Total:</span>
                  <span className="text-lg font-bold text-green-700">
                    {formatCurrency(totalMontos)}
                  </span>
                </div>
              </div>
            </form>

            {/* Footer */}
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <Button
                type="button"
                variant="outline"
                className="flex-1 font-bold border-blue-600 text-blue-700 hover:bg-blue-50"
                onClick={() => { setModalOpen(false); setEditingRecibo(null); }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="flex-1 bg-blue-700 hover:bg-blue-800 text-white font-bold gap-2"
                disabled={isSaving}
                onClick={() => formik.handleSubmit()}
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingRecibo ? "Guardar Cambios" : "Crear Recibo"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Eliminar */}
      {confirmDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl border border-red-100 w-full max-w-sm mx-4 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-red-100 rounded-full p-2">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Eliminar Recibo</h3>
            </div>
            <p className="text-sm text-gray-600">
              ¿Estás seguro de que deseas eliminar este recibo? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmDelete(null)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={() => handleDelete(confirmDelete)}
              >
                Eliminar
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
