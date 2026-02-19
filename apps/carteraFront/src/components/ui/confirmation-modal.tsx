import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, CheckCircle } from "lucide-react";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmText?: string;
  cancelText?: string | null; // Permitir null para ocultar
  variant?: "default" | "destructive" | "success";
  isLoading?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  variant = "default",
  isLoading = false,
}: ConfirmationModalProps) {
  
  // Configuración dinámica basada en variantes
  const getVariantStyles = () => {
    switch (variant) {
      case "destructive":
        return {
          headerBg: "bg-red-50",
          iconBg: "bg-red-100",
          iconColor: "text-red-600",
          titleColor: "text-red-900",
          buttonVariant: "destructive" as const,
          buttonClass: "bg-red-600 hover:bg-red-700",
          Icon: AlertTriangle
        };
      case "success":
        return {
          headerBg: "bg-green-50",
          iconBg: "bg-green-100",
          iconColor: "text-green-600",
          titleColor: "text-green-900",
          buttonVariant: "default" as const,
          buttonClass: "bg-green-600 hover:bg-green-700",
          Icon: CheckCircle
        };
      default:
        return {
          headerBg: "bg-gray-50",
          iconBg: "bg-gray-200",
          iconColor: "text-gray-700",
          titleColor: "text-gray-900",
          buttonVariant: "default" as const,
          buttonClass: "bg-blue-600 hover:bg-blue-700",
          Icon: Loader2 // Placeholder, normally generic info
        };
    }
  };

  const styles = getVariantStyles();
  const Icon = styles.Icon;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isLoading && onClose()}>
      {/* Agregado bg-white para evitar transparencia */}
      <DialogContent className="sm:max-w-[450px] bg-white shadow-2xl border-none p-0 overflow-hidden rounded-xl">
        
        {/* Encabezado */}
        <div className={`px-6 py-6 flex items-start gap-4 ${styles.headerBg}`}>
          <div className={`p-3 rounded-full flex-shrink-0 ${styles.iconBg}`}>
             <Icon className={`h-6 w-6 ${styles.iconColor}`} />
          </div>
          <div className="space-y-1">
            <DialogTitle className={`text-xl font-bold ${styles.titleColor}`}>
              {title}
            </DialogTitle>
          </div>
        </div>

        {/* Contenido */}
        <div className="px-6 py-4">
           <DialogDescription className="text-base text-gray-600 leading-relaxed">
            <>{description}</>
          </DialogDescription>
        </div>

        {/* Pie con botones */}
        <DialogFooter className="px-6 py-4 bg-gray-50 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 border-t border-gray-100">
          {cancelText && (
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isLoading}
              className="mt-2 sm:mt-0 font-semibold text-gray-700 hover:bg-gray-200 hover:text-gray-900"
            >
              {cancelText}
            </Button>
          )}
          
          <Button
            variant={styles.buttonVariant}
            onClick={onConfirm}
            disabled={isLoading}
            className={`min-w-[120px] font-bold shadow-sm ${styles.buttonClass}`}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Procesando...
              </>
            ) : (
              confirmText
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
