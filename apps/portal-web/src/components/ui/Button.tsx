import React from "react";
import { motion } from "framer-motion";

interface ButtonProps {
  children: string;
  size?: "lg" | "md" | "sm";
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  className?: string;
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  size = "lg",
  onClick,
  type = "button",
  className = "",
  isLoading = false,
}) => {
  const sizeClasses = {
    lg: "w-[225px] h-[59px] px-7 py-[10px] text-body",
    md: "w-[180px] h-12 px-5 py-2 text-lg",
    sm: "w-[150px] h-10 px-4 py-1.5 text-base",
  };

  return (
    <motion.button
      onClick={onClick}
      disabled={isLoading}
      whileHover={
        !isLoading
          ? {
              scale: 1.05,
              boxShadow: "0 0 6px rgba(116, 116, 116, 0.5)",
            }
          : {}
      }
      whileTap={!isLoading ? { scale: 0.95 } : {}}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 17,
      }}
      className={`
        ${sizeClasses[size]}
        flex items-center justify-center gap-2
        border border-white/65 rounded-full bg-transparent
        font-semibold text-[rgba(255,255,255,0.65)] cursor-pointer
        hover:border-0 hover:bg-[rgba(15,15,15,1)] hover:text-white
        active:border-0 active:bg-[rgba(15,15,15,1)] active:text-white
        disabled:opacity-70 disabled:cursor-not-allowed
        ${className}
      `}
      type={type}
    >
      {isLoading && (
        <motion.div
          className="flex gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {[0, 1, 2].map((index) => (
            <motion.div
              key={index}
              className="w-2 h-2 bg-current rounded-full"
              animate={{
                scale: [1, 1.3, 1],
                opacity: [1, 0.5, 1],
              }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                delay: index * 0.15,
              }}
            />
          ))}
        </motion.div>
      )}
      <span className={isLoading ? "opacity-70" : ""}>{children}</span>
    </motion.button>
  );
};

