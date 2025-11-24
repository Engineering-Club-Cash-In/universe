import { IconArrowDown } from "../icons";
import { useState, useRef, useEffect } from "react";

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
}

export const Select = ({ options, value, onChange, placeholder = "Seleccionar...", color = "secondary" }: SelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(option => option.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div ref={selectRef} style={{ position: "relative", width: "100%" }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          height: "50px",
          borderRadius: "6.882px",
          border: "0.86px solid #374151",
          background: "rgba(0, 0, 0, 0.00)",
          color: selectedOption ? "#FFFFFF" : "#9CA3AF",
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          fontSize: "16px",
          fontFamily: "inherit",
          transition: "border-color 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#4B5563";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#374151";
        }}
      >
        <span>{selectedOption ? selectedOption.label : placeholder}</span>
        <div className={"text-" + color} style={{
          display: "flex",
          alignItems: "center",
          transition: "transform 0.2s",
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
 
        }}>
          <IconArrowDown width={16} height={16} />
        </div>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            borderRadius: "6.88px",
            border: "1px solid #364050",
            opacity: 0.99,
            background: "#0F0F0F",
            zIndex: 1000,
            maxHeight: "300px",
            overflowY: "auto",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
          }}
        >
          {options.map((option) => (
            <div
              key={option.value}
              onClick={() => handleSelect(option.value)}
              style={{
                padding: "12px 16px",
                color: "#FFFFFF",
                cursor: "pointer",
                fontSize: "16px",
                transition: "background-color 0.2s",
                backgroundColor: option.value === value ? "#1F2937" : "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#1F2937";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = option.value === value ? "#1F2937" : "transparent";
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
