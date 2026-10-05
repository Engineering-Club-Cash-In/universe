/**
 * El usuario es inversionista pero cartera confirmó que no tiene NINGUNA ficha
 * asociada.
 *
 * Es un estado propio y no un vacío: sin ficha no hay nada que ver ni nada que
 * editar, y la salida no está en esta pantalla sino en que un humano del equipo
 * lo asocie. Se dice con las mismas palabras que "Mis Inversiones"
 * (`MyInvestments.tsx:168-183`) para que la misma situación no se cuente de dos
 * maneras distintas según la pestaña.
 */
export const SinEntidades = ({ queVerias }: { queVerias: string }) => (
  <div className="max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-8">
    <p className="text-gray">
      Tu usuario todavía no está vinculado a un inversionista. Escribile a tu
      asesor para que lo asocien y acá vas a ver {queVerias}.
    </p>
  </div>
);
