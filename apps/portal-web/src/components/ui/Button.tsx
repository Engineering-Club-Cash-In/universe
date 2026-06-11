import React from "react";
import { motion } from "framer-motion";
import { IconWhatsApp } from "../icons/IconWhatsApp";

interface ButtonProps {
  children: React.ReactNode;
  size?: "lg" | "md" | "sm" | "xs";
  variant?: "default" | "whatsapp" | "secondary";
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  className?: string;
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  size = "lg",
  variant = "default",
  onClick,
  type = "button",
  className = "bg-transparent",
  isLoading = false,
}) => {
  const sizeClasses = {
    lg: "min-w-[225px] h-[59px] px-7 py-[10px] text-body",
    md: "min-w-[180px] h-12 px-5 py-2 text-lg",
    sm: "min-w-[150px] h-10 px-4 py-1.5 text-base",
    xs: "min-w-[120px] h-8 px-3 py-1 text-sm",
  };

  const isWhatsApp = variant === "whatsapp";
  const isSecondary = variant === "secondary";

  const hoverShadow = isWhatsApp
    ? "0 0 6px 0 rgba(37, 211, 102, 0.60)"
    : isSecondary
      ? "0 0 10px 0 rgba(201, 168, 76, 0.40)"
      : "0 0 6px 0 rgba(116, 116, 116, 0.65)";

  const variantClasses = isSecondary
    ? "border-transparent bg-secondary text-white hover:bg-secondary/90 active:bg-secondary/80"
    : isWhatsApp
      ? "border-white/65 bg-transparent text-[rgba(255,255,255,0.65)] hover:border-black hover:bg-[#0F0F0F] hover:text-[#25D366] active:border-black active:bg-[#0F0F0F] active:text-[#25D366]"
      : "border-white/65 bg-transparent text-[rgba(255,255,255,0.65)] hover:border-[#747474] hover:bg-[#0F0F0F] hover:text-white active:border-[#747474] active:bg-[#0F0F0F] active:text-white";

  return (
    <motion.button
      onClick={onClick}
      disabled={isLoading}
      whileHover={
        !isLoading
          ? {
              scale: 1.05,
              boxShadow: hoverShadow,
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
        border rounded-full
        font-semibold cursor-pointer
        ${variantClasses}
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
      {isWhatsApp && <IconWhatsApp className="fill-current" />}
      <span className={isLoading ? "opacity-70" : ""}>{children}</span>
    </motion.button>
  );
};

