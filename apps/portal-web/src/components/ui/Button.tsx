import React from "react";

interface ButtonProps {
  children: string;
  size?: "lg" | "md" | "sm";
  onClick?: () => void;
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  size = "lg",
  onClick,
  className = "",
}) => {
  const sizeClasses = {
    lg: "w-[225px] h-[59px] px-7 py-[10px] text-[22px]",
    md: "w-[180px] h-12 px-5 py-2 text-lg",
    sm: "w-[150px] h-10 px-4 py-1.5 text-base",
  };

  return (
    <button
      onClick={onClick}
      className={`
        ${sizeClasses[size]}
        flex items-center justify-center
        border border-white/65 rounded-full bg-transparent
        font-semibold text-inherit cursor-pointer
        transition-all duration-200 ease-in-out
        hover:border-0 hover:shadow-[0_0_6px_rgba(116,116,116,0.5)] hover:bg-[rgba(15,15,15,1)]
        active:border-0 active:shadow-[0_0_6px_rgba(116,116,116,0.5)] active:bg-[rgba(15,15,15,1)]
        ${className}
      `}
    >
      {children}
    </button>
  );
};

