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
        id: "exterior",
        title: "Exterior",
        points: [
            { id: "emblemas", label: "Emblemas (parrilla, laterales, traseros)" },
            { id: "persiana", label: "Persiana" },
            { id: "bumper_delantero", label: "Bumper delantero" },
            { id: "luces_delanteras", label: "Luces Delanteras (Verificar funcionamiento de lueces altas y bajas)" },
            { id: "neblineras", label: "Neblineras" },
            { id: "luces_intermitentes", label: "Luces Intermitentes" },
            { id: "limpiabrisas", label: "Limpiabrisas" },
            { id: "antena", label: "Antena" },
            { id: "luces_traseras", label: "Luces traseras (Verificar funcionamiento de luz de freno, luz media, pidevías, luz de inebla, tercera luz de treno, luz de placa)" },
            { id: "bumper_trasero", label: "Bumper trasero" },
            { id: "cobertor_palangana", label: "Cobertor de palangana y/o Cortina metálica de palangana" },
        ]
    },
    {
        id: "interior",
        title: "Interior",
        points: [
            { id: "tablero", label: "Tablero o cuadro" },
            { id: "millaje", label: "Millaje con el que ingresó a Guatemala (en caso de ser rodado), verificar que haga sentido con el millaje actual." },
            { id: "consola_central", label: "Consola Central" },
            { id: "radio_pantalla", label: "Radio / Pantalla" },
            { id: "guantera", label: "Guantera" },
            { id: "seguros_puertas", label: "Seguros de puertas" },
            { id: "manijas_puertas", label: "Manijas de puertas" },
            { id: "mandos_ventanas", label: "Mandos de ventanas" },
            { id: "luces_interiores", label: "Luces interiores" },
            { id: "retrovisor_central", label: "Retrovisor central" },
            { id: "retrovisores_electricos", label: "Retrovisores eléctricos" },
            { id: "mandos_volante", label: "Mandos al volante" },
            { id: "consola_ac", label: "Consola A/C" },
            { id: "filtro_cabina", label: "Filtro de cabina A/C (filtro de polen)" },
            { id: "tapiceria_butacas_del", label: "Tapicería butacas delanteras" },
            { id: "tapiceria_butacas_tras", label: "Tapicería butacas traseras" },
            { id: "tapiceria_puertas", label: "Tapicería puertas" },
            { id: "alfombras", label: "Alfombras" },
            { id: "tapasol", label: "Tapasol" },
        ]
    },
    {
        id: "seguridad",
        title: "Seguridad",
        points: [
            { id: "cinturones", label: "Cinturones de seguridad funcionales" },
            { id: "isofix", label: "Sistema Isofix / LATCH" },
            { id: "bolsas_aire", label: "Bolsas de aire" },
        ]
    },
    {
        id: "herramientas",
        title: "Herramientas",
        points: [
            { id: "tricket", label: "Tricket (Gato Hidráulico)" },
            { id: "cruceta", label: "Cruceta (Llave de Chuchos)" },
            { id: "copa_especial", label: "Copa especial para pernos de seguridad" },
            { id: "extension_tricket", label: "Extensión de tricket" },
        ]
    },
    {
        id: "aros_y_llantas",
        title: "Aros y Llantas",
        points: [
            { id: "desgaste_llantas", label: "Verificar desgaste de llantas (Desgaste irregular)" },
            { id: "profundidad_rodadura", label: "Profundidad de la banda de rodadura adecuada (Vida útil de las llantas)" },
            { id: "presion_aire", label: "Presión de aire correcta en todos los neumáticos (incluida la rueda de repuesto)" },
            { id: "abultamientos", label: "Verificar abultamientos o cortes laterales" },
            { id: "sensores_tpms", label: "Verificar funcionamiento de sensores TPMS" },
            { id: "estado_aros", label: "Verificar estado de aros (Golpes, raspones, etc.)" },
            { id: "tapones_aros", label: "Tapones de aros (Indicar si están incompletos o dañados)" },
            { id: "llanta_repuesto", label: "Llanta de repuesto" },
        ]
    },
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
            { id: "filtro_aire", label: "Filtro de aire" },
            { id: "compresiones", label: "Compresiones" }, // Este necesita metadata
        ]
    },
    {
        id: "frenos_suspension",
        title: "Frenos y Suspensión",
        points: [
            { id: "liquido_frenos", label: "Líquido de frenos (nivel, color, humedad)" },
            { id: "pastillas_discos", label: "Verificar estado de pastillas y discos de freno (surcos profundos, desgaste o marcas inusuales)" },
            { id: "lineas_frenos", label: "Verificar estado de líneas, mangueras y conexiones de frenos (corrosión o fugas)" },
            { id: "pedal_freno", label: "Recorrido del pedal de freno (altura, juego libre y distancia de reserva)" },
            { id: "amortiguadores", label: "Amortiguadores y suspensión (prueba de rebote, ausencia de fugas, bases de amortiguadores)" },
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
            { id: "holgura_direccion", label: "Holgura de la dirección (excesivo movimiento del volante sin respuesta)" },
        ]
    },
    {
        id: "sistema_electrico",
        title: "Sistema Eléctrico, Electrónico y Otros",
        points: [
            { id: "prueba_obd2", label: "Prueba de escaner OBD2" },
            { id: "cables_bujias", label: "Cables de bujías y bobinas" },
            { id: "arneses_electricos", label: "Arnéses eléctricos" },
            { id: "estado_bateria", label: "Estado de la batería (terminales limpios, sin corrosión)" },
            { id: "ac_calefaccion_accesorios", label: "Funcionamiento del aire acondicionado, calefacción, radio y otros accesorios" },
            { id: "limpiaparabrisas_liquido", label: "Limpiaparabrisas y líquido lavaparabrisas operativos" },
            { id: "vidrios_sunroof", label: "Vidrios eléctricos y sunroof funcionales" },
            { id: "bocina", label: "Bocina funcional" },
            { id: "testigos_tablero", label: "Testigos presentes en tablero" },
        ]
    },
    {
        id: "chasis",
        title: "Chasis",
        points: [
            { id: "largueros", label: "Largueros (Longitudinales)" },
            { id: "travesanos", label: "Travesaños (Transversales)" },
            { id: "puntos_soldadura", label: "Puntos de unión y soldadura" },
            { id: "puntas_chasis", label: "Puntas de chasis frontales (verificar deformaciones o reparaciones mayores)" },
            { id: "alineacion_chasis", label: "Alineación general del chasis" },
        ]
    },
    {
        id: "identificacion_vehiculo",
        title: "Números de identificación del vehículo",
        points: [
            { id: "numero_motor", label: "Número de motor (Verificar que coincida físicamente con la tarjeta de circulación)." },
            { id: "numero_chasis", label: "Número de chasis (Verificar que coincida físicamente con la tarjeta de circulación)." },
            { id: "numero_vin", label: "VIN (Verificar que coincida físicamente con la tarjeta de circulación)." },
        ]
    }
];
