# Pruebas del bot con el equipo de IT

**Ambiente:** dev (base `green-tree`) · **Fecha:** 2026-08-14
**Datos:** `apps/crm/apps/server/src/db/seeds/bot-cobros-pruebas.sql` — **lo corre el usuario**

Cada persona del equipo tiene un **cliente ficticio a su nombre amarrado a su celular**, así
cada quien tiene su propio código y puede recorrer el flujo completo sin tocar datos de
clientes reales.

---

## ⏳ Hoy el código NO llega por SMS

El proveedor solo acepta peticiones desde **IPs que estén en su whitelist** y la del servidor
de dev no está, así que el mensaje nunca sale. Para no quedarnos parados, la instancia corre
con `BOT_COBROS_OTP_SIMULADO=true`: el código se genera igual pero **no se manda**, y se
consulta por API ([D-21](./DECISIONES.md#d-21--modo-simulado-mientras-el-sms-no-sale)).

En la práctica, el paso "esperar el SMS" se cambia por esto:

```bash
# La referencia sale en la respuesta del primer paso (servicio 1)
curl -s -X POST https://crmapi-cobros.s2.devteamatcci.site/api/bot/cobros/pruebas/otp \
  -H "Authorization: Bearer $BOT_COBROS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"referencia":"LA-REFERENCIA"}'
# → { "otp": "6126", "usado": false, "intentosFallidos": 0, "expiraEnSegundos": 299 }
```

Todo lo demás se comporta igual que en producción: el código vence a los 5 minutos, sirve una
sola vez y se bloquea a los 3 intentos fallidos. **Solo funciona con estos clientes de
prueba**: con un cliente real responde `403`.

Cuando el proveedor habilite la IP del servidor, se apaga esa variable y el SMS llega sin
tocar nada más.

---

## Antes de empezar

| Requisito | Detalle |
| --- | --- |
| Migraciones | `0033` (aplicada) y **`0034`** — sin la 0034, Sofía (que no tiene DPI) no puede recibir código |
| Datos | Correr `src/db/seeds/bot-cobros-pruebas.sql` en green-tree |
| `BOT_COBROS_API_KEY` | Configurada en el ambiente de dev y entregada a SimpleTech |
| **`BOT_COBROS_OTP_SIMULADO=true`** | Mientras la IP del servidor no esté habilitada. Sin esto, el servicio 1 tarda 60 s y devuelve `OTP_NO_ENVIADO` |
| `TEST_MESSAGE=false` | Para cuando vuelva el SMS: con `true`, **todos** los mensajes se redirigen al primer número de la lista y nadie recibe su propio código. Como estos clientes ficticios ya tienen los números del equipo, acá va en `false` |

---

## Quién prueba qué

| Persona | Celular | Cliente ficticio | Qué caso especial cubre |
| --- | --- | --- | --- |
| 1 | 5844 6376 | Mario Andrés Pérez Prueba | Caso normal · **tiene codeudora** (Andrea) |
| 2 | 5709 9747 | Lucía Gómez Prueba | Su **NIT solo está en la oportunidad**, no en el lead |
| 3 | 3521 9722 | Carlos José Ramírez Prueba | Su primer teléfono es un **fijo** → el código debe llegar al segundo. Placa guardada **con espacio** |
| 4 | 3004 7424 | Ana Morales Prueba | Teléfono guardado **con 502** · placa guardada **en minúsculas** |
| 5 | 3044 0828 | Jorge Luis Castillo Prueba | Teléfonos separados con **`/`** · placa guardada **sin la letra inicial** |
| 6 | 4770 5027 | Sofía Herrera Prueba | **No tiene DPI**: solo puede entrar por NIT o placa |
| 7 | 5467 3367 | Diego Alberto Vásquez Prueba | **Dos créditos**: debe salir el menú para elegir |
| 8 | 5922 6561 | Andrea Solórzano Prueba | **Codeudora**: debe ver su crédito **y** el de Mario |

Además hay un cliente sin teléfono (**Pedro Menéndez Prueba**, DPI `9900000950101`) que
cualquiera puede usar para ver el mensaje de "contacta a soporte".

---

## Mensajes para enviar a cada quien

> Copiar y pegar. Cambiar solo el nombre del contacto del bot cuando exista.

> ⏳ **Agregarle esto a todos** mientras la IP no esté habilitada, para que nadie se quede
> esperando un SMS que no va a llegar:
>
> ```
> OJO: por ahora el código NO te va a llegar por SMS (falta que el proveedor habilite la IP
> del servidor). Pedímelo cuando llegués a ese paso y te lo paso al toque.
> ```

### 1 · Para el del 5844 6376

```
¡Hola! Ya podés probar el bot de cobros en dev 🤖

Tu cliente de prueba se llama Mario Andrés Pérez Prueba y está amarrado a tu celular.

Podés identificarte con cualquiera de estos:
• DPI:   9900000280101
• NIT:   90000011
• Placa: P-901BOT

Deberías ver: Toyota Yaris 2019 · P-901BOT

Probá también escribir la placa de otras formas (P901BOT, p 901 bot) — todas deben funcionar.
Contame si algo no cuadra.
```

### 2 · Para el del 5709 9747

```
¡Hola! Ya podés probar el bot de cobros en dev 🤖

Tu cliente de prueba se llama Lucía Gómez Prueba y está amarrado a tu celular.

Podés identificarte con:
• DPI:   9900000360101
• NIT:   90000022
• Placa: P-902BOT

Deberías ver: Mazda CX-5 2020 · P-902BOT

Tu caso prueba algo específico: el NIT de este cliente NO está en su ficha, solo en el
crédito. Aun así el bot tiene que encontrarte por NIT. Avisame si no.
```

### 3 · Para el del 3521 9722

```
¡Hola! Ya podés probar el bot de cobros en dev 🤖

Tu cliente de prueba se llama Carlos José Ramírez Prueba y está amarrado a tu celular.

Podés identificarte con:
• DPI:   9900000440101
• NIT:   90000033
• Placa: P-903BOT

Deberías ver: Kia Rio 2018 · P 903BOT

Tu caso prueba dos cosas: este cliente tiene un teléfono FIJO de primero y tu celular de
segundo — el código igual te tiene que llegar a vos. Y su placa está guardada con un
espacio, así que escribirla normal (P-903BOT) también debe funcionar.
```

### 4 · Para el del 3004 7424

```
¡Hola! Ya podés probar el bot de cobros en dev 🤖

Tu cliente de prueba se llama Ana Morales Prueba y está amarrado a tu celular.

Podés identificarte con:
• DPI:   9900000520101
• NIT:   90000044
• Placa: P-904BOT

Deberías ver: Hyundai Tucson 2021 · p-904bot

Tu caso prueba que funcione aunque el teléfono esté guardado con el 502 adelante, y que la
placa se encuentre aunque en la base esté en minúsculas.
```

### 5 · Para el del 3044 0828

```
¡Hola! Ya podés probar el bot de cobros en dev 🤖

Tu cliente de prueba se llama Jorge Luis Castillo Prueba y está amarrado a tu celular.

Podés identificarte con:
• DPI:   9900000600101
• NIT:   90000055
• Placa: P-905BOT

Deberías ver: Nissan Frontier 2017 · 905BOT

Tu caso prueba que los teléfonos separados con "/" se lean bien, y que la placa se
encuentre aunque en la base quedó guardada SIN la letra inicial (905BOT).
Probá escribirla de las dos formas: P-905BOT y 905BOT.
```

### 6 · Para el del 4770 5027

```
¡Hola! Ya podés probar el bot de cobros en dev 🤖

Tu cliente de prueba se llama Sofía Herrera Prueba y está amarrado a tu celular.

OJO: este cliente NO tiene DPI en el sistema (hay 274 clientes reales así). Solo podés
entrar con:
• NIT:   90000066
• Placa: P-906BOT

Deberías ver: Suzuki Swift 2022 · P-906BOT

Si probás con un DPI cualquiera, el bot debe decirte que no encontró nada.
```

### 7 · Para el del 5467 3367

```
¡Hola! Ya podés probar el bot de cobros en dev 🤖

Tu cliente de prueba se llama Diego Alberto Vásquez Prueba y está amarrado a tu celular.

Podés identificarte con:
• DPI:   9900000790101
• NIT:   90000077
• Placa: P-907BOT  (o P-910BOT)

Tu caso es el de VARIOS CRÉDITOS: después de validar tu código deberías ver DOS para elegir:
• Toyota Hilux 2020 · P-907BOT
• Mitsubishi L200 2023 · P-910BOT

Fijate que salga el menú para escoger y no te mande directo a uno.
```

### 8 · Para el del 5922 6561

```
¡Hola! Ya podés probar el bot de cobros en dev 🤖

Tu cliente de prueba se llama Andrea Solórzano Prueba y está amarrado a tu celular.

Podés identificarte con:
• DPI:   9900000870101
• NIT:   90000088
• Placa: P-908BOT

Tu caso es el de CODEUDOR. Andrea tiene su propio crédito Y es codeudora del crédito de
Mario, así que después de validar tu código deberías ver DOS:
• Honda CR-V 2019 · P-908BOT      (el suyo)
• Toyota Yaris 2019 · P-901BOT    (donde es codeudora)

Ese segundo es el importante: confirma que un codeudor puede entrar con su propio DPI y su
propio celular.
```

---

## Qué debería pasar en cada paso

1. **Escribís tu DPI, NIT o placa** → el bot saluda con el nombre del cliente y avisa que
   mandó un código a un número terminado en `****XXXX`.
2. **Conseguís el código de 4 dígitos**, vigente 5 minutos. Hoy no llega por SMS: se pide
   como se explica arriba. Cuando habiliten la IP, llegará solo.
3. **Escribís el código** → el bot muestra el crédito (o el menú, si hay varios).

## Errores que vale la pena provocar

| Probá esto | Debería responder |
| --- | --- |
| Un código equivocado | "El código no es correcto" y te dice cuántos intentos te quedan |
| El mismo código dos veces | "Ese código ya fue utilizado" |
| Esperar más de 5 minutos | "Tu código venció" |
| Fallar el código 3 veces | "Alcanzaste el máximo de intentos" |
| Un DPI que no existe (ej. `1234567890101`) | Que no encontró nada, sin decir más |
| Escribir "hola" o cualquier palabra | Que le mandés tu NIT, DPI o placa |
| El DPI `9900000950101` (Pedro, sin teléfono) | Que no hay número registrado y que contacte a soporte |

## Qué reportar

- Qué escribiste, qué te respondió y a qué hora.
- Si el nombre o el vehículo salen mal escritos.
- Que el SMS no llegue **no hay que reportarlo**: es lo esperado hasta que habiliten la IP.

---

## Limpieza

Al terminar la fase de pruebas, el bloque comentado al final de
`bot-cobros-pruebas.sql` borra todo (leads, vehículos, oportunidades, codeudor y sus OTP).
Los ids empiezan con `b07…` para poder identificarlos.
