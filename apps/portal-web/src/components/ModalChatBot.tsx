import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui";

export interface ModalOption {
  type: "whatsapp" | "schedule" | string;
  title: string;
  description: string;
  buttonText: string;
  buttonAction: () => void;
}

interface ModalChatBotProps {
  open: boolean;
  onClose: () => void;
  options: ModalOption[];
}

export const ModalChatBot: React.FC<ModalChatBotProps> = ({
  open,
  onClose,
  options,
}) => {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 25,
            }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          >
            <div
              className="pointer-events-auto relative flex max-w-4/5 lg:w-[580px] px-12 py-7 justify-center items-center rounded-2xl"
              style={{
                background: "#0D0D0D",
                boxShadow: "0 0 17.153px 17.153px rgba(0, 0, 0, 0.25)",
              }}
            >
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-6 right-6 text-white/65 hover:text-white transition-colors"
              >
                <svg
                  width="24"
                  height="24"
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

              {/* Content */}
              <div className="flex flex-col items-center  gap-8 w-full">
                {options.map((option, index) => (
                  <motion.div
                    key={`${option.type}-${index}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex flex-col gap-4 items-center text-center  justify-center"
                  >
                    <h3 className="text-lg w-4/5">{option.title}</h3>
                    <p className="text-gray text-base leading-relaxed">
                      {option.description}
                    </p>
                    <div>
                      <Button onClick={option.buttonAction} size="md">
                        {option.buttonText}
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
