const fs = require('fs');
const path = require('path');

// Helper functions that the template expects
const formatoFecha = (fechaStr) => {
    const fecha = new Date(fechaStr);
    return fecha.toLocaleDateString('es-GT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const formatoMoneda = (monto) => {
    return new Intl.NumberFormat('es-GT', {
        style: 'currency',
        currency: 'GTQ'
    }).format(monto);
};

// Sample data object
const datos = {
    serie: '6A7B8C9D',
    numero: '123456789',
    uuid: 'E60BCAE7-0009-48B0-AF25-0D1ED9F9642B',
    fechaEmision: '2025-12-18T10:00:00',
    fechaCertificacion: '2025-12-18T10:05:00',
    logoUrl: 'https://via.placeholder.com/160x80?text=LOGO+EMPRESA',
    emisor: {
        nombreComercial: 'Soluciones Tecnológicas S.A.',
        nombre: 'Soluciones Tecnológicas de Guatemala, Sociedad Anónima',
        nit: '1234567-8',
        direccion: {
            'dte:Direccion': 'Avenida Reforma 12-34, Zona 10',
            'dte:Municipio': 'Guatemala',
            'dte:Departamento': 'Guatemala'
        }
    },
    receptor: {
        nombre: 'Juan Pérez García',
        nit: '8765432-1'
    },
    items: [
        {
            numeroLinea: 1,
            descripcion: 'Servicio de Consultoría IT - Diciembre 2025',
            cantidad: 1,
            unidad: 'UNI',
            precioUnitario: 2500.00,
            total: 2500.00
        },
        {
            numeroLinea: 2,
            descripcion: 'Licencia de Software Enterprise (Anual)',
            cantidad: 2,
            unidad: 'UNI',
            precioUnitario: 1200.00,
            total: 2400.00
        },
        {
            numeroLinea: 3,
            descripcion: 'Soporte Técnico Remoto',
            cantidad: 5,
            unidad: 'HOR',
            precioUnitario: 150.00,
            total: 750.00
        }
    ],
    abonos: [
        { numero: 1, fechaVencimiento: '2026-01-18', monto: 2825.00 },
        { numero: 2, fechaVencimiento: '2026-02-18', monto: 2825.00 }
    ],
    totales: {
        iva: 605.36,
        granTotal: 5650.00
    },
    certificador: {
        nombre: 'GuateFacturas S.A.',
        nit: '9988776-5'
    }
};

// Load template
const templatePath = path.join(__dirname, 'index.html');
let template = fs.readFileSync(templatePath, 'utf8');

// Simple function to evaluate the template as a template literal
// Note: In a real app, you'd use a proper template engine like EJS or Handlebars
const generateHtml = (template, data) => {
    const { logoUrl, datos } = data;
    // We use a function constructor to evaluate the template string in a controlled scope
    const func = new Function('logoUrl', 'datos', 'formatoFecha', 'formatoMoneda', `return \`${template}\`;`);
    return func(logoUrl, datos, formatoFecha, formatoMoneda);
};

try {
    const finalHtml = generateHtml(template, { logoUrl: datos.logoUrl, datos });
    const outputPath = path.join(__dirname, 'factura_ejemplo.html');
    fs.writeFileSync(outputPath, finalHtml);
    console.log(`✅ Factura generada exitosamente en: ${outputPath}`);
} catch (error) {
    console.error('❌ Error al generar la factura:', error);
}
