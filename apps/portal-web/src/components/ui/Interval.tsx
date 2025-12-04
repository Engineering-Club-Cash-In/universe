import { useState, useRef, useEffect, useCallback } from "react";

interface IntervalProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  label?: string;
}

export const Interval = ({ min, max, value, onChange, label }: IntervalProps) => {
  const [isDragging, setIsDragging] = useState<"min" | "max" | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const calculatePosition = (val: number) => {
    return ((val - min) / (max - min)) * 100;
  };

  const calculateValue = useCallback((percentage: number) => {
    const val = min + (percentage / 100) * (max - min);
    return Math.round(val);
  }, [min, max]);

  const handleMouseDown = (thumb: "min" | "max") => {
    setIsDragging(thumb);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !trackRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const percentage = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const newValue = calculateValue(percentage);

      if (isDragging === "min") {
        if (newValue < value[1]) {
          onChange([newValue, value[1]]);
        }
      } else if (newValue > value[0]) {
        onChange([value[0], newValue]);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(null);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, value, onChange, calculateValue]);

  const minPosition = calculatePosition(value[0]);
  const maxPosition = calculatePosition(value[1]);

  return (
    <div className="w-full">
      {label && (
        <label className="block mb-3 text-white text-sm font-medium">
          {label}
        </label>
      )}
      
      <div className="relative px-2">
        {/* Track */}
        <div
          ref={trackRef}
          className="relative h-1 bg-white/10 rounded-sm cursor-pointer"
        >
          {/* Active range */}
          <div
            className="absolute h-full bg-primary rounded-sm"
            style={{
              left: `${minPosition}%`,
              right: `${100 - maxPosition}%`,
            }}
          />
        </div>

        {/* Min thumb */}
        <div
          role="slider"
          tabIndex={0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value[0]}
          onMouseDown={() => handleMouseDown("min")}
          className="absolute top-1/2 w-4 h-4 bg-primary rounded-full cursor-pointer border-2 border-[#0F0F0F] shadow-md"
          style={{
            left: `${minPosition}%`,
            transform: "translate(-50%, -50%)",
            transition: isDragging === "min" ? "none" : "transform 0.1s",
          }}
          onMouseEnter={(e) => {
            if (!isDragging) {
              e.currentTarget.style.transform = "translate(-50%, -50%) scale(1.2)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isDragging) {
              e.currentTarget.style.transform = "translate(-50%, -50%) scale(1)";
            }
          }}
        />

        {/* Max thumb */}
        <div
          role="slider"
          tabIndex={0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value[1]}
          onMouseDown={() => handleMouseDown("max")}
          className="absolute top-1/2 w-4 h-4 bg-primary rounded-full cursor-pointer border-2 border-[#0F0F0F] shadow-md"
          style={{
            left: `${maxPosition}%`,
            transform: "translate(-50%, -50%)",
            transition: isDragging === "max" ? "none" : "transform 0.1s",
          }}
          onMouseEnter={(e) => {
            if (!isDragging) {
              e.currentTarget.style.transform = "translate(-50%, -50%) scale(1.2)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isDragging) {
              e.currentTarget.style.transform = "translate(-50%, -50%) scale(1)";
            }
          }}
        />
      </div>

      {/* Value display */}
      <div className="flex justify-between mt-3 text-xs text-gray-400">
        <span>{value[0].toLocaleString()}</span>
        <span>{value[1].toLocaleString()}</span>
      </div>
    </div>
  );
};
