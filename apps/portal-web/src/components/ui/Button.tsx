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
  const sizeStyles = {
    lg: {
      width: "225px",
      height: "59px",
      paddingTop: "10px",
      paddingRight: "28px",
      paddingBottom: "10px",
      paddingLeft: "28px",
      gap: "10px",
      fontSize: "22px",
    },
    md: {
      // Agrega las medidas para MD aqu� cuando las tengas
      width: "180px",
      height: "48px",
      paddingTop: "8px",
      paddingRight: "20px",
      paddingBottom: "8px",
      paddingLeft: "20px",
      gap: "8px",
      fontSize: "18px",
    },
    sm: {
      // Agrega las medidas para SM aqu� cuando las tengas
      width: "150px",
      height: "40px",
      paddingTop: "6px",
      paddingRight: "16px",
      paddingBottom: "6px",
      paddingLeft: "16px",
      gap: "6px",
      fontSize: "16px",
    },
  };

  const currentSize = sizeStyles[size];

  return (
    <button
      onClick={onClick}
      className={`button-component ${className}`}
      style={{
        ...currentSize,
        borderWidth: "1px",
        borderRadius: "50px",
        border: "1px solid rgba(255, 255, 255, 0.65)",
        opacity: 1,
        backgroundColor: "transparent",
        color: "inherit",
        cursor: "pointer",
        transition: "all 0.2s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.border = "none";
        e.currentTarget.style.borderWidth = "0px";
        e.currentTarget.style.boxShadow =
          "0px 0px 6px 0px rgba(116, 116, 116, 0.5)";
        e.currentTarget.style.backgroundColor = "rgba(15, 15, 15, 1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.border = "1px solid rgba(255, 255, 255, 0.65)";
        e.currentTarget.style.borderWidth = "1px";
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.backgroundColor = "transparent";
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.border = "none";
        e.currentTarget.style.borderWidth = "0px";
        e.currentTarget.style.boxShadow =
          "0px 0px 6px 0px rgba(116, 116, 116, 0.5)";
        e.currentTarget.style.backgroundColor = "rgba(15, 15, 15, 1)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.border = "1px solid rgba(255, 255, 255, 0.65)";
        e.currentTarget.style.borderWidth = "1px";
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {children}
    </button>
  );
};
