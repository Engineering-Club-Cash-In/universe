import { useIsMobile } from "@/hooks";
import { IconArrowDown } from "../icons";
import { useState, useRef, useEffect, useId } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  color?: string;
  variant?: "dark" | "light" | "secondary";
  disabled?: boolean;
}

export const Select = ({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  color = "secondary",
  variant = "dark",
  disabled,
}: SelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const listboxId = useId();
  const isMobile = useIsMobile();

  const selectedOption = options.find((option) => option.value === value);

  // Estilos según variante
  const isLight = variant === "light";
  const isSecondary = variant === "secondary";

  const buttonStyles = isSecondary
    ? {
        background: "#D9D9D9",
        color: selectedOption ? "#000000" : "#6B7280",
        border: "0 solid transparent",
      }
    : isLight
      ? {
          background: "#F9FAFB",
          color: selectedOption ? "#6B7280" : "#9CA3AF",
          border: "0 solid #E5E7EB",
        }
      : {
          background: "rgba(0, 0, 0, 0.00)",
          color: selectedOption ? "#FFFFFF" : "#9CA3AF",
          border: "0.86px solid #374151",
        };

  const dropdownStyles = isSecondary
    ? {
        background: "#D9D9D9",
        border: "1px solid #BFBFBF",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.15)",
      }
    : isLight
      ? {
          background: "#FFFFFF",
          border: "1px solid #E5E7EB",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
        }
      : {
          background: "#0F0F0F",
          border: "1px solid #364050",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
        };

  const optionTextColor = isSecondary ? "#000000" : isLight ? "#6B7280" : "#FFFFFF";
  const optionHoverBg = isSecondary ? "#C4C4C4" : isLight ? "#F3F4F6" : "#1F2937";
  const optionSelectedBg = isSecondary ? "#BFBFBF" : isLight ? "#E5E7EB" : "#1F2937";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        selectRef.current &&
        !selectRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const selectedIndex = options.findIndex((option) => option.value === value);

  const openWithKeyboard = () => {
    if (disabled || options.length === 0) return;
    setIsOpen(true);
    requestAnimationFrame(() => {
      optionRefs.current[selectedIndex >= 0 ? selectedIndex : 0]?.focus();
    });
  };

  const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openWithKeyboard();
    }
  };

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    optionIndex: number,
    optionValue: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSelect(optionValue);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (optionIndex + offset + options.length) % options.length;
      optionRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div ref={selectRef} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        ref={buttonRef}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleButtonKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        style={{
          width: "100%",
          height: isSecondary ? "auto" : isLight ? "58px" : "50px",
          borderRadius: isSecondary ? "8px" : isLight ? "8px" : "6.882px",
          padding: isSecondary ? "16px" : isLight ? "16px" : "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          fontSize: isMobile ? "14px" : "16px",
          fontFamily: "inherit",
          transition: "border-color 0.2s",
          ...buttonStyles,
        }}
        onMouseEnter={(e) => {
          if (!isLight && !isSecondary) {
            e.currentTarget.style.borderColor = "#4B5563";
          }
        }}
        onMouseLeave={(e) => {
          if (!isLight && !isSecondary) {
            e.currentTarget.style.borderColor = "#374151";
          }
        }}
      >
        <span>{selectedOption ? selectedOption.label : placeholder}</span>
        <div
          className={"text-" + color}
          style={{
            display: "flex",
            alignItems: "center",
            transition: "transform 0.2s",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <IconArrowDown width={16} height={16} />
        </div>
      </button>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={placeholder}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            borderRadius: isSecondary ? "8px" : isLight ? "8px" : "6.88px",
            opacity: 0.99,
            zIndex: 1000,
            maxHeight: "300px",
            overflowY: "auto",
            ...dropdownStyles,
          }}
        >
          {options.map((option, optionIndex) => (
            <div
              key={option.value}
              ref={(element) => {
                optionRefs.current[optionIndex] = element;
              }}
              role="option"
              aria-selected={option.value === value}
              tabIndex={0}
              onClick={() => handleSelect(option.value)}
              onKeyDown={(event) =>
                handleOptionKeyDown(event, optionIndex, option.value)
              }
              style={{
                padding: "12px 16px",
                color: optionTextColor,
                cursor: "pointer",
                fontSize: "16px",
                transition: "background-color 0.2s",
                backgroundColor:
                  option.value === value ? optionSelectedBg : "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = optionHoverBg;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor =
                  option.value === value ? optionSelectedBg : "transparent";
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
