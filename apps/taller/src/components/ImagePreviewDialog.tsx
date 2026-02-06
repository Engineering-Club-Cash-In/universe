import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface ImagePreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    imageUrl: string | null;
    title?: string;
}

export function ImagePreviewDialog({
    open,
    onOpenChange,
    imageUrl,
    title = "Vista previa de imagen",
}: ImagePreviewDialogProps) {
    if (!imageUrl) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black/5 border-none shadow-none sm:rounded-lg">
                <div className="relative w-full h-full flex flex-col bg-background rounded-lg shadow-lg overflow-hidden">
                    <DialogHeader className="p-4 border-b shrink-0 flex flex-row items-center justify-between bg-white z-10">
                        <DialogTitle>{title}</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/20 min-h-[50vh] max-h-[80vh]">
                        <img
                            src={imageUrl}
                            alt={title}
                            className="max-w-full max-h-full object-contain rounded-md shadow-sm"
                        />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
