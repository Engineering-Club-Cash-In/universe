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
import type { PagosNexaCredito } from "../services/nexaDashboard.services";
import { textoAdvertenciaPagosNexa } from "../lib/advertenciaPagosNexa";

export function AdvertenciaPagosNexaDialog({
  open,
  pagos,
  accion,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pagos: PagosNexaCredito | null;
  accion: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="bg-white text-slate-900">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-slate-900">Este crédito tiene pagos de Nexa</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-600">
            {textoAdvertenciaPagosNexa(pagos, accion)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Sí, continuar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
