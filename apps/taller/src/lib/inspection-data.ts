export interface InspectionPoint {
    id: string;
    label: string; // Se guardará como "checkpoint" en la BD
}

export interface InspectionCategory {
    id: string;
    title: string; // Se guardará como "area" en la BD
    points: InspectionPoint[];
}

export const INSPECTION_AREAS: InspectionCategory[] = [
    {
        id: "motor_transmision",
        title: "Motor y Transmisión",
        points: [
            { id: "ruidos_vibraciones", label: "Verificar ruidos o vibraciones anormales al encender" },
            { id: "fugas_aceite", label: "Verificar fugas de aceite o líquido de transmisión" },
            { id: "nivel_aceite", label: "Nivel y estado del aceite del motor (color, consistencia)" },
            { id: "nivel_refrigerante", label: "Nivel y estado del líquido refrigerante" },
            { id: "humo_escape", label: "Verificar humo inusual en el escape (negro, azul o blanco constante)" },
            { id: "mangueras_correas", label: "Mangueras y correas en buen estado, sin grietas ni desgaste" },
            { id: "scanner_obd2", label: "Prueba de escáner OBD2" },
        ]
    },
    {
        id: "frenos_suspension",
        title: "Frenos y Suspensión",
        points: [
            { id: "liquido_frenos", label: "Líquido de frenos (Nivel, color, humedad)" },
            { id: "pastillas_discos", label: "Verificar estado de pastillas y discos de freno (surcos, desgaste)" },
            { id: "lineas_frenos", label: "Verificar estado de líneas, mangueras y conexiones de frenos" },
            { id: "pedal_freno", label: "Recorrido del pedal de freno (altura, juego libre)" },
            { id: "amortiguadores", label: "Amortiguadores y suspensión (rebote, fugas, bases)" },
            { id: "guardapolvos", label: "Guardapolvos y silentblocks visibles en buen estado" },
        ]
    },
    {
        id: "tren_delantero",
        title: "Tren Delantero y Dirección",
        points: [
            { id: "rotulas", label: "Rótulas" },
            { id: "bujes", label: "Bujes" },
            { id: "puntas_flecha", label: "Puntas de flecha" },
            { id: "cremallera", label: "Cremallera (verificación de fugas, estado de puntas)" },
            { id: "barra_estabilizadora", label: "Barra estabilizadora" },
            { id: "holgura_direccion", label: "Holgura de la dirección" },
        ]
    },
    {
        id: "sistema_electrico",
        title: "Sistema Eléctrico y Otros",
        points: [
            { id: "luces", label: "Funcionamiento de todas las luces exteriores e interiores" },
            { id: "bateria", label: "Estado de la batería (terminales limpios, sin corrosión)" },
            { id: "ac_accesorios", label: "Funcionamiento del A/C, calefacción, radio y accesorios" },
            { id: "limpiaparabrisas", label: "Limpiaparabrisas y líquido lavaparabrisas operativos" },
            { id: "vidrios_electricos", label: "Vidrios eléctricos y sunroof funcionales" },
            { id: "bocina", label: "Bocina funcional" },
        ]
    },
    {
        id: "seguridad",
        title: "Seguridad",
        points: [
            { id: "cinturones", label: "Cinturones de seguridad funcionales" },
            { id: "bolsas_aire", label: "Bolsas de aire" },
        ]
    },
    {
        id: "llantas",
        title: "Estado de Llantas",
        points: [
            { id: "desgaste_llantas", label: "Verificar desgaste de llantas (Desgaste irregular)" },
            { id: "profundidad_rodadura", label: "Profundidad de la banda de rodadura adecuada" },
            { id: "presion_aire", label: "Presión de aire correcta en todos los neumáticos" },
            { id: "abultamientos", label: "Verificar abultamientos o cortes laterales" },
        ]
    }
];
