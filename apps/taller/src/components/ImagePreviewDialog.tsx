import {
    Dialog,
    DialogContent,
    DialogHeader,
} from "@/components/ui/dialog";
import { X, Loader2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface ImagePreviewDialogProps {
    isOpen: boolean;
    onClose: () => void;
    imageUrl?: string | null;
    images?: string[];
    initialIndex?: number;
    title?: string;
}

export default function ImagePreviewDialog({
    isOpen,
    onClose,
    imageUrl,
    images = [],
    initialIndex = 0,
    title = "Evidencia de Rechazo",
}: ImagePreviewDialogProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(initialIndex);

    const targetImages = images.length > 0 ? images : (imageUrl ? [imageUrl] : []);
    const currentImageUrl = targetImages[currentIndex] || null;

    // Initialize index when dialog opens
    useEffect(() => {
        if (isOpen) {
            setCurrentIndex(Math.min(initialIndex, Math.max(0, targetImages.length - 1)));
        }
    }, [isOpen, initialIndex, targetImages.length]);

    // Reset loading states when current image URL changes
    useEffect(() => {
        if (isOpen && currentImageUrl) {
            setIsLoading(true);
            setHasError(false);
        }
    }, [currentImageUrl, isOpen]);

    // Preload next and previous images for smoother navigation
    useEffect(() => {
        if (isOpen && targetImages.length > 1) {
            if (currentIndex < targetImages.length - 1) {
                const img = new Image();
                img.src = targetImages[currentIndex + 1];
            }
            if (currentIndex > 0) {
                const img = new Image();
                img.src = targetImages[currentIndex - 1];
            }
        }
    }, [currentIndex, isOpen, targetImages]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen || targetImages.length <= 1) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") {
                setCurrentIndex(prev => Math.min(prev + 1, targetImages.length - 1));
            } else if (e.key === "ArrowLeft") {
                setCurrentIndex(prev => Math.max(prev - 1, 0));
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, targetImages.length]);

    const handleNext = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (currentIndex < targetImages.length - 1) {
            setCurrentIndex(prev => prev + 1);
        }
    };

    const handlePrev = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
        }
    };

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
                <div className="flex-1 flex items-center justify-center w-full h-full bg-black/90 rounded-lg overflow-hidden relative group">
                    {currentImageUrl ? (
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
                                    key={currentImageUrl}
                                    src={currentImageUrl}
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
                            
                            {/* Controles de Navegación */}
                            {targetImages.length > 1 && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(
                                            "absolute left-4 top-1/2 -translate-y-1/2 rounded-full w-12 h-12 bg-black/50 hover:bg-black/70 text-white border border-white/20 transition-all opacity-0 group-hover:opacity-100",
                                            currentIndex === 0 && "opacity-0 pointer-events-none"
                                        )}
                                        onClick={handlePrev}
                                        disabled={currentIndex === 0}
                                    >
                                        <ChevronLeft className="h-8 w-8" />
                                    </Button>
                                    
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(
                                            "absolute right-4 top-1/2 -translate-y-1/2 rounded-full w-12 h-12 bg-black/50 hover:bg-black/70 text-white border border-white/20 transition-all opacity-0 group-hover:opacity-100",
                                            currentIndex === targetImages.length - 1 && "opacity-0 pointer-events-none"
                                        )}
                                        onClick={handleNext}
                                        disabled={currentIndex === targetImages.length - 1}
                                    >
                                        <ChevronRight className="h-8 w-8" />
                                    </Button>

                                    {/* Indicador de posición */}
                                    <div className="absolute top-4 left-4 bg-black/60 px-3 py-1.5 rounded-full text-white text-sm font-medium backdrop-blur-sm border border-white/10">
                                        {currentIndex + 1} / {targetImages.length}
                                    </div>
                                </>
                            )}

                            {/* Título en la parte inferior */}
                            <div className="absolute bottom-0 left-0 right-0 p-4 bg-linear-to-t from-black/80 to-transparent text-white">
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
