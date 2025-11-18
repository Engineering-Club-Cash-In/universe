interface CustomInputProps {
  icon: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export default function CustomInput({
  icon,
  label,
  placeholder,
  value,
  onChange,
}: CustomInputProps) {
  // Determine input type and value prefix based on label
  const inputType = label === "dpi" || label === "monto" ? "number" : "text";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value;
    onChange(newValue);
  };

  return (
    <div className="flex flex-row w-full h-[50px] justify-between items-center gap-2 rounded-full bg-white text-purple p-2">
      {(label === "dpi" || label === "monto") && (
        <>
          <img src={icon} alt={label} className="w-8 h-8" />
          {label === "monto" && <span className="text-lg font-bold">Q.</span>}
          <input
            type={inputType}
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            className="text-lg placeholder:text-purple font-bold"
          />
        </>
      )}
      {label === "plazo" && (
        <select
          name="plazo"
          id="plazo-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="text-lg placeholder:text-purple font-bold flex-grow"
        >
          <option value="">Seleccione un plazo</option>
          <option value="1">1 año</option>
          <option value="2">2 años</option>
          <option value="3">3 años</option>
          <option value="4">4 años</option>
          <option value="5">5 años</option>
        </select>
      )}
    </div>
  );
}
