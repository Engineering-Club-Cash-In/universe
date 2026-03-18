import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export async function generateInspectionPdf(vehicle: any) {
  const doc = new jsPDF();

  const formatCurrency = (value: number | string) =>
    `Q${Number(value).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatAreaName = (area: string) => {
    if (!area) return "";
    return area.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  // Convert logo URL to base64 if possible
  let logoBase64: string | null = null;
  try {
    const defaultLogo = "https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/LOGO_NUEVO_CASHIN.png";
    const rawLogoUrl = import.meta.env.VITE_LOGO_URL || defaultLogo;
    const strippedLogoUrl = rawLogoUrl.replace(/^https?:\/\//, "");
    const encodedLogoUrl = encodeURIComponent(strippedLogoUrl);
    const logoUrl = `https://wsrv.nl/?url=${encodedLogoUrl}&w=200&output=png`;
    
    try {
      const response = await fetch(logoUrl);
      if (response.ok) {
        const blob = await response.blob();
        if (blob.type.startsWith('image/')) {
          logoBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } else {
          console.warn("Respuesta del proxy logo no es imagen", blob.type);
        }
      } else {
        console.warn("Fallo el fetch del logo", response.status);
      }
    } catch (e) {
      console.warn("Fallo el request del proxy del logo", e);
    }
  } catch (e) {
    console.error("No se pudo cargar el logo", e);
  }

  // Branding Colors
  const primaryColor = [16, 74, 98]; // Dark blue/teal from Cashin/CRM style
  const secondaryColor = [80, 80, 80];

  // Header Start
  let y = 20;

  if (logoBase64) {
    doc.addImage(logoBase64, "PNG", 14, y - 5, 25, 25);
  }

  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text("Informe de Inspección", logoBase64 ? 45 : 14, y + 5);
  
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text(vehicle.licensePlate, logoBase64 ? 45 : 14, y + 12);

  // Meta info right aligned
  doc.setFontSize(10);
  const dateStr = vehicle.inspectionDate ? new Date(vehicle.inspectionDate).toLocaleDateString("es-GT") : "N/A";
  doc.text(`Fecha: ${dateStr}`, 196, y, { align: "right" });
  doc.text(`Técnico: ${vehicle.technicianName || "N/A"}`, 196, y + 6, { align: "right" });

  // Divider
  y += 20;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(14, y, 196, y);

  // Vehicle Info
  y += 12;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text("Datos del Vehículo", 14, y);

  y += 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text("Marca/Modelo:", 14, y);
  doc.text("VIN:", 14, y + 6);
  doc.text("Color:", 105, y);
  doc.text("Kilometraje:", 105, y + 6);
  doc.text("Combustible:", 105, y + 12);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  doc.text(`${vehicle.vehicleMake} ${vehicle.vehicleModel} ${vehicle.vehicleYear}`, 45, y);
  doc.text(vehicle.vinNumber, 45, y + 6);
  doc.text(vehicle.color, 135, y);
  doc.text(`${Number(vehicle.kmMileage).toLocaleString()} km`, 135, y + 6);
  doc.text(vehicle.fuelType, 135, y + 12);

  // Conditions
  y += 22;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text("Condiciones Generales", 14, y);

  y += 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  
  doc.text("Pintura:", 14, y);
  doc.text("Llanta Del. Izq:", 14, y + 6);
  doc.text("Llanta Del. Der:", 14, y + 12);
  doc.text("Testigo Airbag:", 14, y + 18);

  doc.text("Llantas (Prom):", 75, y);
  doc.text("Llanta Tras. Izq:", 75, y + 6);
  doc.text("Llanta Tras. Der:", 75, y + 12);

  doc.text("Prueba manejo:", 140, y);
  doc.text("Scanner:", 140, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  
  doc.text(`${vehicle.paintCondition || 0}%`, 47, y);
  doc.text(`${vehicle.tireConditionFrontLeft || 0}%`, 47, y + 6);
  doc.text(`${vehicle.tireConditionFrontRight || 0}%`, 47, y + 12);
  doc.text(vehicle.airbagWarning, 47, y + 18);

  doc.text(`${vehicle.tiresCondition || 0}%`, 110, y);
  doc.text(`${vehicle.tireConditionRearLeft || 0}%`, 110, y + 6);
  doc.text(`${vehicle.tireConditionRearRight || 0}%`, 110, y + 12);

  doc.text(vehicle.testDrive, 172, y);
  doc.text(vehicle.hasScanner ? 'Sí' : 'No', 172, y + 6);
  
  // Update Y for the following sections
  y += 12;

  // All 360 Check items
  y += 18;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text("Revisión 360", 14, y);

  if (vehicle.all360Items && vehicle.all360Items.length > 0) {
    const checksData = vehicle.all360Items.map((check: any) => [
      formatAreaName(check.area),
      check.checkpoint,
      check.status,
      check.comment || "",
    ]);

    autoTable(doc, {
      startY: y + 5,
      head: [["Área", "Punto de revisión", "Estado", "Comentarios"]],
      body: checksData,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: primaryColor as any, textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      willDrawCell: function (data) {
        if (data.section === "body" && data.column.index === 2) {
          const status = data.cell.text[0];
          if (status === "BAD" || status === "LEGACY_BAD") doc.setTextColor(200, 50, 50);
          else if (status === "REGULAR") doc.setTextColor(200, 150, 50);
          else if (status === "GOOD" || status === "OK") doc.setTextColor(50, 150, 50);
        }
      },
      didDrawCell: function (data) {
        // Reset color safely
        doc.setTextColor(0, 0, 0);
      }
    });
    y = (doc as any).lastAutoTable.finalY + 12;
  } else {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(150, 150, 150);
    y += 7;
    doc.text("No se registraron datos en la revisión 360.", 14, y);
    y += 10;
  }

  // All Checklist issues
  if (y > 230) {
    doc.addPage();
    y = 20;
  }
  
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text("Checklist de Puntos Críticos", 14, y);

  if (vehicle.allChecklistItems && vehicle.allChecklistItems.length > 0) {
    const checklistData = vehicle.allChecklistItems.map((item: any) => [
      item.item,
      item.checked ? "Sí" : "No",
      item.severity === "critical" ? "Crítico" : item.severity === "warning" ? "Advertencia" : item.severity,
      item.notes || "",
      (item.evidence && item.evidence.length > 0) ? `Fotos: ${item.evidence.map((_: any, i: number) => `[${i + 1}]`).join(' ')}` : ""
    ]);

    autoTable(doc, {
      startY: y + 5,
      head: [["Punto Evaluado", "Anomalía", "Gravedad", "Notas Adicionales", "Evidencia"]],
      body: checklistData,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: primaryColor as any, textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      willDrawCell: function (data) {
        if (data.section === "body" && data.column.index === 4 && data.cell.text.length > 0 && data.cell.text[0].startsWith("Fotos:")) {
          doc.setTextColor(0, 102, 204); // Link color
        }
        if (data.section === "body" && data.column.index === 1 && data.cell.text[0] === "Sí") {
           doc.setTextColor(200, 50, 50); // Red if marked anomaly
        }
        if (data.section === "body" && data.column.index === 2) {
           if (data.cell.text[0] === "Crítico") doc.setTextColor(200, 50, 50);
           else if (data.cell.text[0] === "Advertencia") doc.setTextColor(200, 150, 50);
        }
      },
      didDrawCell: function (data) {
        doc.setTextColor(0, 0, 0); // reset
        if (data.section === "body" && data.column.index === 4 && data.cell.text.length > 0 && data.cell.text[0].startsWith("Fotos:")) {
          const check = vehicle.allChecklistItems[data.row.index];
          if (check && check.evidence && check.evidence.length > 0) {
            const padding = typeof data.cell.styles.cellPadding === 'number' 
              ? data.cell.styles.cellPadding 
              : ((data.cell.styles.cellPadding as any)?.top || 2);
            
            const numLines = data.cell.text.length;
            const lineHeight = (data.cell.height - padding * 2) / Math.max(1, numLines);
            let currentY = data.cell.y + padding;

            let photoIdx = 0;
            data.cell.text.forEach((textLine: string) => {
              let currentX = data.cell.x + padding;
              const parts = textLine.split(/(\[\d+\])/g);
              
              parts.forEach(part => {
                const partWidth = doc.getTextWidth(part);
                if (part.match(/\[\d+\]/)) {
                  const ev = check.evidence[photoIdx];
                  if (ev && ev.url) {
                    doc.link(currentX, currentY, partWidth, lineHeight, { url: ev.url });
                  }
                  photoIdx++;
                }
                currentX += partWidth;
              });
              currentY += lineHeight;
            });
          }
        }
      }
    });
    y = (doc as any).lastAutoTable.finalY + 12;
  } else {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(150, 150, 150);
    y += 7;
    doc.text("No se registraron revisiones de puntos críticos.", 14, y);
    y += 10;
  }

  // Main Photos
  if (y > 230) {
    doc.addPage();
    y = 20;
  }
  
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text("Registro Fotográfico Principal", 14, y);

  if (vehicle.allPhotos && vehicle.allPhotos.length > 0) {
    // Select one photo per available category
    const photosByCategory: Record<string, any[]> = {};
    vehicle.allPhotos.forEach((p: any) => {
      const cat = p.category ? p.category.toLowerCase() : 'otros';
      if (!photosByCategory[cat]) photosByCategory[cat] = [];
      photosByCategory[cat].push(p);
    });

    const preferredOrder = [
      'exterior',
      'interior',
      'engine', 'motor',
      'wheels', 'llantas',
      'damage', 'daños',
      'others', 'otros'
    ];
    let mainPhotos: any[] = [];
    
    preferredOrder.forEach(cat => {
      // Find matches treating 'fotografías exteriores' as 'exterior', etc.
      const matchedKeys = Object.keys(photosByCategory).filter(k => k.includes(cat));
      if (matchedKeys.length > 0) {
        mainPhotos.push(photosByCategory[matchedKeys[0]][0]);
        // Remove so we don't pick it again
        delete photosByCategory[matchedKeys[0]];
      }
    });

    // Add any remaining categories
    Object.keys(photosByCategory).forEach(cat => {
      if (photosByCategory[cat].length > 0) {
        mainPhotos.push(photosByCategory[cat][0]);
      }
    });

    // Limit to max 6 photos to keep it concise
    mainPhotos = mainPhotos.slice(0, 6);
    
    const formatCategoryName = (cat: string) => {
      const map: Record<string, string> = {
        'exterior': 'Exterior',
        'interior': 'Interior',
        'engine': 'Motor',
        'wheels': 'Llantas',
        'damage': 'Daños',
        'others': 'Otros'
      };
      return map[cat.toLowerCase()] || cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    const photosTableData = mainPhotos.map((photo: any) => [
      formatCategoryName(photo.category || "Otros"),
      photo.title || photo.photoType || "Sin título",
      photo.url ? "Ver foto" : "N/A"
    ]);

    autoTable(doc, {
      startY: y + 5,
      head: [["Categoría", "Descripción", "Enlace"]],
      body: photosTableData,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: primaryColor as any, textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      willDrawCell: function (data) {
        if (data.section === "body" && data.column.index === 2 && data.cell.text[0] === "Ver foto") {
          doc.setTextColor(0, 102, 204); // Link color
        }
      },
      didDrawCell: function (data) {
        doc.setTextColor(0, 0, 0); // reset
        if (data.section === "body" && data.column.index === 2 && data.cell.text[0] === "Ver foto") {
          const photo = mainPhotos[data.row.index];
          if (photo && photo.url) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, {
              url: photo.url
            });
          }
        }
      }
    });
    
    y = (doc as any).lastAutoTable.finalY + 12;
  } else {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(150, 150, 150);
    y += 7;
    doc.text("No se registraron fotografías principales.", 14, y);
    y += 10;
  }

  // Valuation
  if (y > 230) {
    doc.addPage();
    y = 20;
  }

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text("Valoración Comercial", 14, y);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  y += 10;
  doc.text(`Valor Comercial Sugerido: ${formatCurrency(vehicle.suggestedCommercialValue || 0)}`, 14, y);
  doc.text(`Valor Actual Condición: ${formatCurrency(vehicle.currentConditionValue || 0)}`, 105, y);

  y += 16;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text("Dictamen Final de Inspección", 14, y);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  y += 8;
  const splitResult = doc.splitTextToSize(vehicle.inspectionResult || "Sin observaciones generadas.", 180);
  doc.text(splitResult, 14, y);

  y += splitResult.length * 5 + 10;


  // Save
  doc.save(`informe-${vehicle.licensePlate}.pdf`);
}
