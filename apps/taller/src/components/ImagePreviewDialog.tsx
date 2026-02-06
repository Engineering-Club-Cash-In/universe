import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { X, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface ImagePreviewDialogProps {
    isOpen: boolean;
    onClose: () => void;
    imageUrl: string | null;
    title?: string;
}

export default function ImagePreviewDialog({
    isOpen,
    onClose,
    imageUrl,
    title = "Evidencia de Rechazo",
}: ImagePreviewDialogProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    // Reset states when dialog opens or URL changes
    useEffect(() => {
        if (isOpen && imageUrl) {
            setIsLoading(true);
            setHasError(false);
        }
    }, [isOpen, imageUrl]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl w-full h-[80vh] flex flex-col p-0 gap-0 bg-transparent border-none shadow-none z-50">
                <DialogHeader className="absolute top-2 right-2 z-10 flex-row justify-end p-0 space-y-0">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        aria-label="Cerrar vista previa"
                        className="rounded-full bg-black/50 hover:bg-black/70 text-white w-10 h-10 border border-white/20 transition-transform hover:scale-105"
                    >
                        <X className="h-6 w-6" />
                    </Button>
                </DialogHeader>

                {/* Contenedor de Imagen con Loader */}
                <div className="flex-1 flex items-center justify-center w-full h-full bg-black/90 rounded-lg overflow-hidden relative">
                    {imageUrl ? (
                        <>
                            {/* Loader */}
                            {isLoading && !hasError && (
                                <div
                                    className="absolute inset-0 flex flex-col items-center justify-center text-white/70 gap-3"
                                    aria-live="polite"
                                    aria-label="Cargando imagen"
                                >
                                    <Loader2 className="h-10 w-10 animate-spin text-white" />
                                    <p className="text-sm font-medium">Cargando evidencia...</p>
                                </div>
                            )}

                            {/* Error State */}
                            {hasError && (
                                <div className="flex flex-col items-center justify-center text-red-400 gap-3">
                                    <AlertCircle className="h-12 w-12" />
                                    <p className="font-medium">No se pudo cargar la imagen</p>
                                </div>
                            )}

                            {/* Imagen */}
                            {!hasError && (
                                <img
                                    key={imageUrl}
                                    src={imageUrl}
                                    alt={title}
                                    className={cn(
                                        "max-w-full max-h-full object-contain transition-opacity duration-300",
                                        isLoading ? "opacity-0" : "opacity-100"
                                    )}
                                    onLoad={() => setIsLoading(false)}
                                    onError={() => {
                                        setHasError(true);
                                        setIsLoading(false);
                                    }}
                                />
                            )}

                            {/* Título en la parte inferior */}
                            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent text-white">
                                <h3 className="text-lg font-semibold text-center">{title}</h3>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-white/50 gap-3">
                            <AlertCircle className="h-12 w-12" />
                            <p className="font-medium">No hay imagen disponible</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
