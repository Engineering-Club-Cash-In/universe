import * as React from "react";
import { Input } from "@/components/ui/input";
import { normalizarEntrada } from "@/lib/numberField";

type NumberInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "onChange" | "min"
> & {
  value: number | null | undefined;
  onValueChange: (value: number) => void;
  /** Con `min >= 0` el campo no deja escribir el signo negativo. */
  min?: number;
};

/**
 * Input numérico que nunca propaga un string al formulario.
 *
 * Formik, para `type="number"`, guarda `""` cuando `parseFloat` da NaN, y eso
 * rompe los `z.number()` con "Expected number, received string". Acá el valor
 * que sale siempre es `number`: si el campo queda vacío se propaga 0 y al salir
 * del campo se vuelve a mostrar el 0.
 */
export function NumberInput({
  value,
  onValueChange,
  onFocus,
  onBlur,
  min,
  ...props
}: NumberInputProps) {
  const [texto, setTexto] = React.useState<string | null>(null);
  // `min` no se pasa al DOM: el input es de tipo text y ahí no significa nada.
  const permiteNegativos = min === undefined || min < 0;

  // `texto` sólo manda mientras el usuario escribe; si no, se muestra el valor del form.
  const mostrado = texto ?? String(value ?? 0);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const siguiente = normalizarEntrada(e.target.value, permiteNegativos);
    if (!siguiente) return; // tecla rechazada: no se toca ni el texto ni el valor

    setTexto(siguiente.texto);
    onValueChange(siguiente.valor);
  };

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={mostrado}
      onChange={handleChange}
      onFocus={(e) => {
        // Sólo se selecciona el 0 por defecto, para que el primer dígito lo
        // reemplace. Un valor real se deja intacto para poder editarlo.
        if (Number(e.target.value) === 0) e.target.select();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setTexto(null);
        onBlur?.(e);
      }}
    />
  );
}
