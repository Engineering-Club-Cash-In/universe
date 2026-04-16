import { useRef, useCallback } from "react";
import { motion } from "framer-motion";

interface DocumentViewerModalProps {
  isOpen: boolean;
  documentName: string;
  documentUrl: string;
  onClose: () => void;
}

export const DocumentViewerModal = ({
  isOpen,
  documentName,
  documentUrl,
  onClose,
}: DocumentViewerModalProps) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleWheel = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    overlay.style.pointerEvents = "none";

    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      overlay.style.pointerEvents = "auto";
    }, 1500);
  }, []);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-dark border border-white/20 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h3 className="text-lg font-semibold truncate pr-4">{documentName}</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Document viewer */}
        <div className="flex-1 overflow-hidden rounded-b-2xl relative">
          <iframe
            src={`${documentUrl}#toolbar=0&navpanes=0`}
            className="w-full h-full border-0"
            title={documentName}
          />
          {/* Overlay: bloquea click derecho, se deshabilita brevemente al hacer scroll */}
          <div
            ref={overlayRef}
            className="absolute inset-0"
            style={{ right: "16px" }}
            onContextMenu={(e) => e.preventDefault()}
            onWheel={handleWheel}
          />
        </div>
      </motion.div>
    </div>
  );
};
