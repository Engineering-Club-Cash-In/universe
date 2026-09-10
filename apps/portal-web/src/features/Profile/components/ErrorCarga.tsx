/**
 * Fallo de carga con reintento.
 *
 * Existe para no confundir "no pudimos traerlo" con "no hay nada": una pantalla
 * vacía después de un error se lee como un dato real y manda al inversionista a
 * llamar a su asesor por algo que era una caída de red.
 */
export const ErrorCarga = ({
  titulo = "No pudimos cargar esta información",
  mensaje = "Puede ser una falla momentánea de conexión. Volvé a intentarlo en un momento.",
  onReintentar,
}: {
  titulo?: string;
  mensaje?: string;
  onReintentar: () => void;
}) => (
  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 max-w-2xl">
    <p className="font-semibold mb-1">{titulo}</p>
    <p className="text-gray text-sm mb-4">{mensaje}</p>
    <button
      type="button"
      onClick={onReintentar}
      className="px-4 py-2 text-sm font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors"
    >
      Reintentar
    </button>
  </div>
);
