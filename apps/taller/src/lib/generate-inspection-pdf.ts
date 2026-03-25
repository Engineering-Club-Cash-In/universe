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
  doc.text("Marca/Modelo/Año:", 14, y);
  doc.text("Versión/Equip.:", 14, y + 6);
  doc.text("Placa:", 14, y + 12);
  doc.text("VIN/Chasis:", 14, y + 18);
  doc.text("No. Motor:", 14, y + 24);
  doc.text("Tipo:", 14, y + 30);
  doc.text("Procedencia:", 14, y + 36);

  doc.text("Color:", 105, y);
  doc.text("Millas:", 105, y + 6);
  doc.text("Kilómetros:", 105, y + 12);
  doc.text("Combustible:", 105, y + 18);
  doc.text("Cilindros:", 105, y + 24);
  doc.text("Motor (CC):", 105, y + 30);
  doc.text("Transmisión:", 105, y + 36);
  doc.text("Tracción:", 105, y + 42);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  doc.text(`${vehicle.vehicleMake || ""} ${vehicle.vehicleModel || ""} ${vehicle.vehicleYear || ""}`, 47, y);
  doc.text(vehicle.trim || "N/A", 47, y + 6);
  doc.text(vehicle.licensePlate || "N/A", 47, y + 12);
  doc.text(vehicle.vinNumber || "N/A", 47, y + 18);
  doc.text(vehicle.motorNumber || "N/A", 47, y + 24);
  doc.text(vehicle.vehicleType || "N/A", 47, y + 30);
  doc.text(vehicle.origin || "N/A", 47, y + 36);

  doc.text(vehicle.color || "N/A", 135, y);
  doc.text(vehicle.milesMileage ? `${Number(vehicle.milesMileage).toLocaleString()} mi` : "N/A", 135, y + 6);
  doc.text(`${Number(vehicle.kmMileage).toLocaleString()} km`, 135, y + 12);
  doc.text(vehicle.fuelType || "N/A", 135, y + 18);
  doc.text(vehicle.cylinders || "N/A", 135, y + 24);
  doc.text(vehicle.engineCC || "N/A", 135, y + 30);
  doc.text(vehicle.transmission || "N/A", 135, y + 36);
  doc.text(vehicle.traction || "N/A", 135, y + 42);

  // Conditions
  y += 52;
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
    const getStandardCategory = (area: string) => {
      if (!area) return "Otros";
      const raw = area.toLowerCase().replace(/_/g, ' ');
      if (raw.includes('exterior')) return "Exterior";
      if (raw.includes('aro') || raw.includes('llanta')) return "Aros y Llantas";
      if (raw.includes('interior')) return "Interior";
      if (raw.includes('seguridad')) return "Seguridad";
      if (raw.includes('herramienta')) return "Herramientas";
      if (raw.includes('electric') || raw.includes('eléctric')) return "Sistema Eléctrico, Electrónico y Otros";
      if (raw.includes('motor') || raw.includes('transmisi')) return "Motor y Transmisión";
      if (raw.includes('identificacion') || raw.includes('identificación') || raw.includes('numeros')) return "Números de identificación del vehículo";
      if (raw.includes('freno') || raw.includes('suspen')) return "Frenos y Suspensión";
      if (raw.includes('tren') || raw.includes('direcci')) return "Tren Delantero y Dirección";
      if (raw.includes('chasis')) return "Chasis";
      return formatAreaName(area);
    };

    const sortedItems = [...vehicle.all360Items].sort((a: any, b: any) => {
      const categoryOrder = [
        "Exterior",
        "Aros y Llantas",
        "Interior",
        "Seguridad",
        "Herramientas",
        "Sistema Eléctrico, Electrónico y Otros",
        "Motor y Transmisión",
        "Números de identificación del vehículo",
        "Frenos y Suspensión",
        "Tren Delantero y Dirección",
        "Chasis",
      ];
      
      const stdA = getStandardCategory(a.area);
      const stdB = getStandardCategory(b.area);

      const getIndex = (stdCat: string) => {
        const index = categoryOrder.indexOf(stdCat);
        return index !== -1 ? index : 998;
      };

      const indexA = getIndex(stdA);
      const indexB = getIndex(stdB);
      
      if (indexA !== indexB) {
        return indexA - indexB;
      }
      
      if (stdA !== stdB) {
         return stdA.localeCompare(stdB);
      }
      
      return (a.checkpoint || "").localeCompare(b.checkpoint || "");
    });

    const checksData: any[] = [];
    let currentArea = "";

    sortedItems.forEach((check: any) => {
      const areaName = getStandardCategory(check.area).toUpperCase();
      if (areaName !== currentArea) {
        currentArea = areaName;
        checksData.push([
          { content: `Área: ${areaName}`, colSpan: 3, styles: { fillColor: primaryColor as any, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' } }
        ]);
        checksData.push([
          { content: "Punto de Verificación", styles: { fillColor: primaryColor as any, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' } },
          { content: "ESTADO", styles: { fillColor: primaryColor as any, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', cellWidth: 25 } },
          { content: "Comentarios", styles: { fillColor: primaryColor as any, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' } }
        ]);
      }
      let commentStr = check.comment || "";
      if (check.checkpoint.toLowerCase().includes("compresiones") && check.metadata) {
        try {
          const mData = typeof check.metadata === 'string' ? JSON.parse(check.metadata) : check.metadata;
          if (mData && typeof mData === 'object') {

            // Use vehicle cylinder count to limit the loop
            let cylCount = 8;
            if (vehicle.cylinders) {
              const parsed = parseInt(vehicle.cylinders.toString().replace(/\D/g, ''), 10);
              if (!isNaN(parsed) && parsed > 0 && parsed <= 16) {
                cylCount = parsed;
              }
            }

            const psiList: string[] = [];
            for (let i = 1; i <= cylCount; i++) {
              const val = mData[`cilindro_${i}`];  // Actual DB key format: cilindro_N
              if (val !== undefined && val !== null && val !== "" && val !== 0 && val !== "0") {
                psiList.push(`• C${i}: ${val} PSI`);
              }
            }

            if (psiList.length > 0) {
              commentStr += (commentStr ? "\n\n" : "") + `Presiones Registradas:\n${psiList.join('\n')}`;
            }
          }
        } catch (e) { /* ignore */ }
      }

      checksData.push([
        check.checkpoint,
        check.status,
        commentStr,
      ]);
    });

    autoTable(doc, {
      startY: y + 5,
      body: checksData,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: {
        0: { cellWidth: 55 },   // Punto de Verificación — más corto
        1: { cellWidth: 22, halign: 'center' },  // ESTADO — fijo
        2: { cellWidth: 'auto' },  // Comentarios — ocupa el resto del espacio
      },
      willDrawCell: function (data) {
        if (data.section === "body" && data.column.index === 1) {
          const status = data.cell.text[0];
          if (status === "BAD" || status === "LEGACY_BAD") doc.setTextColor(200, 50, 50);
          else if (status === "REGULAR") doc.setTextColor(200, 150, 50);
          else if (status === "GOOD" || status === "OK") doc.setTextColor(50, 150, 50);
          else if (status === "ESTADO") doc.setTextColor(255, 255, 255);
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
      item.notes || "",
      (item.evidence && item.evidence.length > 0) ? `Fotos: ${item.evidence.map((_: any, i: number) => `[${i + 1}]`).join(' ')}` : ""
    ]);

    autoTable(doc, {
      startY: y + 5,
      head: [["Punto Evaluado", "Anomalía", "Notas Adicionales", "Evidencia"]],
      body: checklistData,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: primaryColor as any, textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      willDrawCell: function (data) {
        if (data.section === "body" && data.column.index === 3 && data.cell.text.length > 0 && data.cell.text[0].startsWith("Fotos:")) {
          doc.setTextColor(0, 102, 204); // Link color
        }
        if (data.section === "body" && data.column.index === 1 && data.cell.text[0] === "Sí") {
           doc.setTextColor(200, 50, 50); // Red if marked anomaly
        }
      },
      didDrawCell: function (data) {
        doc.setTextColor(0, 0, 0); // reset
        if (data.section === "body" && data.column.index === 3 && data.cell.text.length > 0 && data.cell.text[0].startsWith("Fotos:")) {
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
    const getStandardPhotoCategory = (cat: string) => {
      const raw = cat.toLowerCase().replace(/_/g, ' ');
      if (raw.includes('exterior')) return "Exterior";
      if (raw.includes('interior')) return "Interior";
      if (raw.includes('motor') || raw.includes('engine')) return "Motor";
      if (raw.includes('llanta') || raw.includes('wheel') || raw.includes('rueda')) return "Ruedas y Neumáticos";
      if (raw.includes('daño') || raw.includes('damage')) return "Daños y Áreas Específicas";
      return "Otros";
    };

    const photosByCategoryAndType: Record<string, Record<string, any[]>> = {};

    vehicle.allPhotos.forEach((p: any) => {
      const dbCat = p.category ? p.category : 'otros';
      const normCat = getStandardPhotoCategory(dbCat);
      const type = p.photoType || p.title || "Otro";

      if (!photosByCategoryAndType[normCat]) photosByCategoryAndType[normCat] = {};
      if (!photosByCategoryAndType[normCat][type]) photosByCategoryAndType[normCat][type] = [];
      photosByCategoryAndType[normCat][type].push(p);
    });

    const preferredCatOrder = [
      'Exterior', 'Ruedas y Neumáticos', 'Interior', 'Motor', 'Daños y Áreas Específicas', 'Otros'
    ];
    
    const photosTableData: any[] = [];
    const urlMap = new Map<number, string>();
    let rIndex = 0;
    
    preferredCatOrder.forEach(cat => {
      if (photosByCategoryAndType[cat]) {
        photosTableData.push([
          { content: `Categoría: ${cat.toUpperCase()}`, colSpan: 3, styles: { fillColor: primaryColor as any, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' } }
        ]);
        rIndex++;

        const typesInCat = Object.keys(photosByCategoryAndType[cat]).sort();
        typesInCat.forEach(type => {
            const photos = photosByCategoryAndType[cat][type];
            photos.sort((a, b) => {
              const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return timeB - timeA;
            });
            const mostRecentPhoto = photos[0];
            
            photosTableData.push([
              mostRecentPhoto.title || mostRecentPhoto.photoType || "Sin título",
              mostRecentPhoto.comment || "", // Strict user comments
              mostRecentPhoto.url ? "Ver foto" : "N/A"
            ]);
            
            if (mostRecentPhoto.url) {
              let photoUrl = mostRecentPhoto.url;
              if (!photoUrl.startsWith('http')) {
                 photoUrl = 'https://' + photoUrl;
              }
              urlMap.set(rIndex, photoUrl);
            }
            rIndex++;
        });
      }
    });

    autoTable(doc, {
      startY: y + 5,
      head: [["Descripción", "Comentarios", "Enlace"]],
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
          const url = urlMap.get(data.row.index);
          if (url) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
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
  doc.text(`Valor de Mercado: ${formatCurrency(vehicle.marketValue || 0)}`, 14, y);
  doc.text(`Valor Comercial Sugerido: ${formatCurrency(vehicle.suggestedCommercialValue || 0)}`, 105, y);
  
  y += 8;
  doc.text(`Valor Actual Condición: ${formatCurrency(vehicle.currentConditionValue || 0)}`, 14, y);

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
  const textHeight = splitResult.length * 5;
  if (y + textHeight > 280) {
    doc.addPage();
    y = 20;
  }
  doc.text(splitResult, 14, y);

  y += textHeight + 10;


  // Save
  doc.save(`informe-${vehicle.licensePlate}.pdf`);
}
