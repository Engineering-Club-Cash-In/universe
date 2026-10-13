import { describe, expect, test } from "bun:test";
import { clasificarDevolucion } from "./ausencia-devolucion";

describe("clasificarDevolucion", () => {
  const detalle = [
    { credito_id: 1, asesor_nuevo_id: 20, bucket: 1 },
    { credito_id: 2, asesor_nuevo_id: 20, bucket: 1 },
    { credito_id: 3, asesor_nuevo_id: 30, bucket: 1 },
    { credito_id: 4, asesor_nuevo_id: 30, bucket: 1 },
    { credito_id: 5, asesor_nuevo_id: 30, bucket: 2 },
  ];

  test("devuelve lo que sigue con quien lo recibió y cuyo bucket está en el pool", () => {
    const r = clasificarDevolucion(
      detalle,
      new Map([
        [1, { asesor_id: 20, bucket: 1 }],
        [2, { asesor_id: 20, bucket: 2 }],
        [3, { asesor_id: 30, bucket: 1 }],
        [4, { asesor_id: 30, bucket: 1 }],
        [5, { asesor_id: 30, bucket: 2 }],
      ]),
      new Set([1, 2]),
    );
    expect(r.aDevolver).toEqual([1, 2, 3, 4, 5]);
    expect(r.retenidos).toEqual([]);
  });

  test("retiene lo que cambió de dueño o subió a un bucket que no atiende", () => {
    const r = clasificarDevolucion(
      detalle,
      new Map([
        [1, { asesor_id: 99, bucket: 1 }], // el motor o un supervisor ya lo movió
        [2, { asesor_id: 20, bucket: null }], // hoy sin bucket operativo (p. ej. EN_CONVENIO)
        [3, { asesor_id: 30, bucket: 4 }], // subió a un bucket que el asesor no atiende
        [4, null], // ya no existe
        [5, { asesor_id: 30, bucket: 1 }],
      ]),
      new Set([1, 2]),
    );
    expect(r.aDevolver).toEqual([5]);
    expect(r.aDevolverDirecto).toEqual([2]);
    expect(r.retenidos).toEqual([
      { credito_id: 1, motivo: "cambio_de_dueno" },
      { credito_id: 3, motivo: "bucket_fuera_del_pool" },
      { credito_id: 4, motivo: "cambio_de_dueno" },
    ]);
  });

  test("lo que estaba en el funnel y hoy no tiene bucket (EN_CONVENIO) se devuelve aparte", () => {
    const r = clasificarDevolucion(
      [
        { credito_id: 7, asesor_nuevo_id: 20, bucket: 0 }, // EN_CONVENIO hoy
        { credito_id: 8, asesor_nuevo_id: 20, bucket: null }, // ya estaba fuera al repartir
      ],
      new Map([
        [7, { asesor_id: 20, bucket: null }],
        [8, { asesor_id: 20, bucket: null }],
      ]),
      new Set([0]),
    );
    expect(r.aDevolverDirecto).toEqual([7]);
    expect(r.aDevolver).toEqual([]);
    expect(r.retenidos).toEqual([{ credito_id: 8, motivo: "fuera_del_funnel" }]);
  });
});
