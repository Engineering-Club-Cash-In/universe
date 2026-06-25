# Logos de aseguradoras

Coloca aquí los logos (PNG o SVG, fondo transparente idealmente):
- `gyt.png`         → logo de G&T Continental (aseguradora "GyT")
- `universales.png` → logo de Universales

Se referencian desde el badge de aseguradora en CreditsPaymentsData.tsx
vía `/aseguradoras/<archivo>` (helper `aseguradoraLogo`). Si falta el archivo,
el badge muestra solo el nombre (con 🛡️ de fallback).
