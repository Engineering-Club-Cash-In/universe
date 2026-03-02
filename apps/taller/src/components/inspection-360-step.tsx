import { useState, useMemo, useEffect } from 'react';
import { useInspection, InspectionStatus, type Inspection360Item } from '../contexts/InspectionContext';
import { INSPECTION_AREAS } from '../lib/inspection-data';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Activity, MinusCircle, AlertTriangle } from 'lucide-react';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Inspection360StepProps {
    onComplete: () => void;
}

export default function Inspection360Step({ onComplete }: Inspection360StepProps) {
    const { items360, setItems360, formData } = useInspection();

    // Determinar cantidad de cilindros (mínimo 1, máximo 8, default 4)
    const cylinderCount = useMemo(() => {
        const cyls = parseInt(formData?.cylinders || '4', 10);
        if (isNaN(cyls)) return 4;
        return Math.max(1, Math.min(8, cyls));
    }, [formData?.cylinders]);

    // Limpiar metadatos de cilindros que ya no existen si bajó la cantidad
    useEffect(() => {
        setItems360((prevItems: Inspection360Item[]) => {
            let overallChanged = false;
            const updatedItems = prevItems.map(item => {
                if (!item.metadata) return item;
                
                const newMetadata = { ...item.metadata };
                let itemChanged = false;
                
                Object.keys(newMetadata).forEach(key => {
                    if (key.startsWith('cilindro_')) {
                        const cylNum = parseInt(key.replace('cilindro_', ''), 10);
                        if (cylNum > cylinderCount) {
                            delete newMetadata[key];
                            itemChanged = true;
                        }
                    }
                });
                
                if (itemChanged) {
                    overallChanged = true;
                    return { ...item, metadata: newMetadata };
                }
                return item;
            });
            
            return overallChanged ? updatedItems : prevItems;
        });
    }, [cylinderCount, setItems360]);

    // Estado local para manejar qué secciones están abiertas
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        [INSPECTION_AREAS[0].id]: true
    });

    const toggleSection = (id: string) => {
        setOpenSections(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const expandAll = () => {
        const allOpen = INSPECTION_AREAS.reduce((acc, area) => ({ ...acc, [area.id]: true }), {});
        setOpenSections(allOpen);
    };

    const collapseAll = () => {
        setOpenSections({});
    };

    const fillWithDummyData = () => {
        const newItems: Inspection360Item[] = [];
        const failureMessages = [
            "Desgaste excesivo visible",
            "Fuga de fluidos detectada",
            "Ruido anormal al operar",
            "Componente flojo o vibrando",
            "Corrosión avanzada",
            "Pieza faltante",
            "Daño físico evidente"
        ];
        
        // Sesgo para datos dummy
        const statuses: InspectionStatus[] = [
            InspectionStatus.GOOD, InspectionStatus.GOOD, InspectionStatus.GOOD, InspectionStatus.GOOD, 
            InspectionStatus.REGULAR, InspectionStatus.BAD, InspectionStatus.NA
        ];

        const MIN_COMPRESSION_PSI = 110;
        const MAX_COMPRESSION_PSI = 150;
        const generateRandomCompression = () => Math.floor(Math.random() * (MAX_COMPRESSION_PSI - MIN_COMPRESSION_PSI + 1) + MIN_COMPRESSION_PSI);

        INSPECTION_AREAS.forEach(area => {
            area.points.forEach(point => {
                const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
                const isFail = randomStatus === InspectionStatus.BAD || randomStatus === InspectionStatus.REGULAR;
                
                if (point.id === 'compresiones') {
                    const compressionMetadata: Record<string, number> = {};
                    // Solo generar para la cantidad de cilindros configurada
                    for (let i = 1; i <= 8; i++) {
                        compressionMetadata[`cilindro_${i}`] = i <= cylinderCount ? generateRandomCompression() : 0;
                    }

                    newItems.push({
                        category: area.id,
                        item: point.label,
                        status: InspectionStatus.GOOD,
                        metadata: compressionMetadata
                    });
                } else {
                    newItems.push({
                        category: area.id,
                        item: point.label,
                        status: randomStatus,
                        notes: isFail ? failureMessages[Math.floor(Math.random() * failureMessages.length)] : undefined
                    });
                }
            });
        });
        setItems360(newItems);
        const allOpen = INSPECTION_AREAS.reduce((acc, area) => ({ ...acc, [area.id]: true }), {});
        setOpenSections(allOpen);
    };

    const handleStatusChange = (category: string, itemLabel: string, status: InspectionStatus) => {
        const existing = items360.slice();
        const existingIndex = existing.findIndex(i => i.item === itemLabel && i.category === category);

        if (existingIndex >= 0) {
            existing[existingIndex] = {
                ...existing[existingIndex],
                status,
                // Si cambia de estado, no borramos las notas para que el usuario siempre las tenga
            };
            setItems360(existing);
        } else {
            setItems360([...existing, { category, item: itemLabel, status }]);
        }
    };

    const handleObservationChange = (category: string, itemLabel: string, notes: string) => {
        const existing = items360.slice();
        const existingIndex = existing.findIndex(i => i.item === itemLabel && i.category === category);
        if (existingIndex >= 0) {
            existing[existingIndex] = { ...existing[existingIndex], notes };
            setItems360(existing);
        } else {
             setItems360([...existing, { category, item: itemLabel, status: InspectionStatus.NA, notes }]);
        }
    };

    const handleMetadataChange = (category: string, itemLabel: string, metadataKey: string, rawValue: string) => {
        let metadataValue: any = rawValue;

        // Validation para los inputs de compresión (cilindro_X)
        if (metadataKey.startsWith('cilindro_')) {
            if (rawValue === '') {
                metadataValue = 0; // Si está vacío, por defecto es 0 para evitar fallos matemáticos
            } else {
                const num = parseInt(rawValue, 10);
                if (isNaN(num)) {
                    return; // Ignorar si escriben letras
                }
                // Limitar entre 0 y 300 PSI
                metadataValue = Math.max(0, Math.min(300, num));
            }
        }

        const existing = items360.slice();
        const existingIndex = existing.findIndex(i => i.item === itemLabel && i.category === category);
        if (existingIndex >= 0) {
            existing[existingIndex] = { 
                ...existing[existingIndex], 
                metadata: {
                    ...(existing[existingIndex].metadata || {}),
                    [metadataKey]: metadataValue
                }
            };
            setItems360(existing);
        } else {
            // Default to 'bueno' explicitly if they start typing compressions without selecting status
            setItems360([...existing, { category, item: itemLabel, status: InspectionStatus.GOOD, metadata: { [metadataKey]: metadataValue } }]);
        }
    };

    const getItemState = (category: string, itemLabel: string) => {
        return items360.find(i => i.category === category && i.item === itemLabel);
    };

    const totalPoints = useMemo(() => INSPECTION_AREAS.reduce((acc, area) => acc + area.points.length, 0), []);
    
    // Todo envuelto permanentemente en useMemo para evitar re-cálculos si items360 no cambia
    const { 
        completedPoints, 
        progressPercentage, 
        isComplete, 
        failedItemsCount, 
        okItemsCount, 
        healthScore 
    } = useMemo(() => {
        const completed = items360.length;
        const _failedItemsCount = items360.filter(i => [InspectionStatus.LEGACY_BAD, InspectionStatus.REGULAR, InspectionStatus.BAD].includes(i.status as InspectionStatus)).length;
        const _okItemsCount = items360.filter(i => [InspectionStatus.OK, InspectionStatus.GOOD, InspectionStatus.NA].includes(i.status as InspectionStatus)).length;
        
        // Calcular Salud
        let _healthScore = 0;
        if (completed > 0) {
            const countableItems = items360.filter(i => i.status !== InspectionStatus.NA);
            if (countableItems.length === 0) {
                _healthScore = 100;
            } else {
                let totalScore = 0;
                countableItems.forEach(item => {
                    if (item.status === InspectionStatus.OK || item.status === InspectionStatus.GOOD) {
                        totalScore += 100;
                    } else if (item.status === InspectionStatus.REGULAR) {
                        totalScore += 50;
                    }
                });
                _healthScore = Math.round(totalScore / countableItems.length);
            }
        }

        return {
            completedPoints: completed,
            progressPercentage: Math.round((completed / totalPoints) * 100),
            isComplete: completed === totalPoints,
            failedItemsCount: _failedItemsCount,
            okItemsCount: _okItemsCount,
            healthScore: _healthScore
        };
    }, [items360, totalPoints]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">

            {/* Resumen Superior */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base sm:text-lg flex flex-col sm:flex-row sm:justify-between gap-2">
                            <span>Progreso de Inspección</span>
                            <Badge variant={isComplete ? "default" : "secondary"} className="w-fit">
                                {progressPercentage}% Completado
                            </Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="w-full bg-slate-200 rounded-full h-2.5">
                            <div
                                className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                                style={{ width: `${progressPercentage}%` }}
                            ></div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                            {completedPoints} de {totalPoints} puntos verificados
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base sm:text-lg flex flex-col sm:flex-row sm:justify-between gap-2">
                            <span>Resumen de Estado</span>
                            <Badge variant={healthScore >= 70 ? "default" : healthScore >= 40 ? "secondary" : "destructive"} className="w-fit">
                                Salud: {healthScore}%
                            </Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                            <div className="flex items-center gap-2 text-green-600 text-sm sm:text-base">
                                <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5" />
                                <span className="font-bold">{okItemsCount}</span> OK / N/A
                            </div>
                            <div className="flex items-center gap-2 text-red-600 text-sm sm:text-base">
                                <XCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                                <span className="font-bold">{failedItemsCount}</span> Regular / Malo
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Controles de Expansión */}
            <div className="flex justify-end gap-2">
                {import.meta.env.VITE_DEV_MODE === 'TRUE' && (
                    <Button variant="ghost" size="sm" onClick={fillWithDummyData} className="text-xs h-8 text-amber-600">
                        <Activity className="h-3 w-3 mr-1" />
                        Fill Dummy
                    </Button>
                )}
                <Button variant="outline" size="sm" onClick={expandAll} className="text-xs h-8">
                    Expandir todos
                </Button>
                <Button variant="outline" size="sm" onClick={collapseAll} className="text-xs h-8">
                    Encoger todos
                </Button>
            </div>

            {/* Áreas de Inspección usando Collapsible */}
            <div className="space-y-4">
                {INSPECTION_AREAS.map((area) => {
                    const areaItems = items360.filter(i => i.category === area.id);
                    const areaTotal = area.points.length;
                    const areaCompleted = areaItems.length;
                    const areaFails = areaItems.filter(i => i.status === InspectionStatus.BAD).length;
                    const isOpen = openSections[area.id];

                    return (
                        <Collapsible
                            key={area.id}
                            open={isOpen}
                            onOpenChange={() => toggleSection(area.id)}
                            className="border rounded-lg bg-white shadow-sm"
                        >
                            <div className="flex items-start justify-between p-3 sm:p-4 gap-3">
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost" className="p-0 hover:bg-transparent flex-1 justify-start h-auto font-normal text-left">
                                        <div className="flex items-start gap-2 w-full">
                                            {isOpen ? (
                                                <ChevronDown className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
                                            ) : (
                                                <ChevronRight className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
                                            )}
                                            <span className="font-semibold text-base sm:text-lg text-slate-800 leading-tight whitespace-normal">{area.title}</span>
                                        </div>
                                    </Button>
                                </CollapsibleTrigger>

                                <div className="flex items-center gap-1.5 sm:gap-3 shrink-0 mt-1">
                                    {areaFails > 0 && (
                                        <Badge variant="secondary" className="gap-1 flex items-center bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200 px-1.5 sm:px-2.5">
                                            <AlertCircle className="h-3 w-3" /> {areaFails}
                                        </Badge>
                                    )}
                                    <Badge variant={areaCompleted === areaTotal ? "outline" : "secondary"} className="text-[10px] sm:text-xs px-1.5 sm:px-2">
                                        {areaCompleted}/{areaTotal}
                                    </Badge>
                                </div>
                            </div>

                            <CollapsibleContent>
                                <div className="px-4 pb-4 space-y-3 pt-0">
                                    <div className="h-px bg-slate-100 mb-4" /> {/* Separator */}

                                    {area.points.map((point) => {
                                        const state = getItemState(area.id, point.label);
                                        const isNa = state?.status === InspectionStatus.NA;
                                        const isBueno = state?.status === InspectionStatus.GOOD || state?.status === InspectionStatus.OK; // Fallback a ok
                                        const isRegular = state?.status === InspectionStatus.REGULAR;
                                        const isMalo = state?.status === InspectionStatus.BAD || state?.status === InspectionStatus.LEGACY_BAD; // Fallback a bad
                                        
                                        const hasWarning = isRegular || isMalo;

                                        return (
                                            <div key={point.id} className={cn(
                                                "p-3 rounded-md border transition-all duration-200",
                                                "bg-white border-slate-200 hover:border-slate-300 flex flex-col gap-3"
                                            )}>
                                                <div className="flex flex-col md:flex-row justify-between md:items-center gap-2 sm:gap-3">
                                                    <div className="flex-1">
                                                        <Label htmlFor={`btn-${point.id}`} className="text-sm font-medium text-slate-700 cursor-pointer whitespace-normal">
                                                            {point.label}
                                                        </Label>
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
                                                        {/* Nuevos botones: N/A, Bueno, Regular, Malo */}
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, InspectionStatus.NA)}
                                                            className={cn(
                                                                "h-7 sm:h-8 px-2 sm:px-3 gap-1 sm:gap-1.5 min-w-[60px] sm:min-w-[70px] text-[10px] sm:text-sm transition-all",
                                                                isNa
                                                                    ? "bg-slate-200 text-slate-900 border-slate-400 font-medium hover:bg-slate-300"
                                                                    : "text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                                                            )}
                                                        >
                                                            <MinusCircle className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5", isNa ? "text-slate-700" : "text-slate-400")} />
                                                            N/A
                                                        </Button>
                                                        
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, InspectionStatus.GOOD)}
                                                            className={cn(
                                                                "h-7 sm:h-8 px-2 sm:px-3 gap-1 sm:gap-1.5 min-w-[70px] sm:min-w-[80px] text-[10px] sm:text-sm transition-all",
                                                                isBueno
                                                                    ? "bg-slate-200 text-slate-900 border-slate-400 font-medium hover:bg-slate-300"
                                                                    : "text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                                                            )}
                                                        >
                                                            <CheckCircle2 className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5", isBueno ? "text-green-600" : "text-slate-400")} />
                                                            Bueno
                                                        </Button>

                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, InspectionStatus.REGULAR)}
                                                            className={cn(
                                                                "h-7 sm:h-8 px-2 sm:px-3 gap-1 sm:gap-1.5 min-w-[75px] sm:min-w-[80px] text-[10px] sm:text-sm transition-all",
                                                                isRegular
                                                                    ? "bg-slate-200 text-slate-900 border-slate-400 font-medium hover:bg-slate-300"
                                                                    : "text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                                                            )}
                                                        >
                                                            <AlertTriangle className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5", isRegular ? "text-amber-500" : "text-slate-400")} />
                                                            Regular
                                                        </Button>

                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, InspectionStatus.BAD)}
                                                            className={cn(
                                                                "h-7 sm:h-8 px-2 sm:px-3 gap-1 sm:gap-1.5 min-w-[65px] sm:min-w-[80px] text-[10px] sm:text-sm transition-all",
                                                                isMalo
                                                                    ? "bg-slate-200 text-slate-900 border-slate-400 font-medium hover:bg-slate-300"
                                                                    : "text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                                                            )}
                                                        >
                                                            <XCircle className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5", isMalo ? "text-red-600" : "text-slate-400")} />
                                                            Malo
                                                        </Button>
                                                    </div>
                                                </div>
                                                
                                                {/* Sección especial de compresiones */}
                                                {point.id === 'compresiones' && (
                                                    <div className="flex flex-col gap-2 bg-slate-50 p-3 rounded-md border border-slate-200">
                                                        <div className="mb-2">
                                                            <Label className="text-xs text-slate-500 font-semibold mb-1 uppercase text-center block w-full border-b pb-1">Tabla de Presión (PSI) por cilindro</Label>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2 sm:gap-4 justify-between">
                                                            {Array.from({ length: cylinderCount }, (_, i) => i + 1).map(cyl => (
                                                                <div key={cyl} className="flex flex-col gap-1 items-center flex-1 min-w-[30%] sm:min-w-[120px]">
                                                                    <Label className="text-[10px] text-muted-foreground">Cilindro {cyl}</Label>
                                                                    <div className="relative w-full">
                                                                        <input 
                                                                            type="number"
                                                                            min="0"
                                                                            placeholder="0"
                                                                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-center font-mono"
                                                                            value={String(state?.metadata?.[`cilindro_${cyl}`] || '')}
                                                                            onChange={(e) => handleMetadataChange(area.id, point.label, `cilindro_${cyl}`, e.target.value)}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Textarea ahora siempre está disponible pero con highlight si hay un warning/malo */}
                                                <div className={cn("pl-0 sm:pl-3 w-full transition-all mt-1", hasWarning ? "border-l-2 border-amber-400" : "border-l-2 border-transparent")}>
                                                    <Textarea
                                                        placeholder={hasWarning ? "Por favor describa el problema encontrado..." : "Comentarios u observaciones adicionales (opcional)..."}
                                                        value={state?.notes || ''}
                                                        onChange={(e) => handleObservationChange(area.id, point.label, e.target.value)}
                                                        maxLength={1000}
                                                        className={cn(
                                                            "min-h-[60px] text-sm resize-none",
                                                            hasWarning ? "bg-amber-50/50 border-amber-200 focus-visible:ring-amber-400" : "bg-slate-50 border-slate-200 focus-visible:ring-slate-300"
                                                        )}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    );
                })}
            </div>

            <div className="mt-12 space-y-4">
                <div className="relative overflow-hidden rounded-2xl border bg-white p-6 shadow-md transition-all hover:shadow-lg">
                    {/* Decorative side bar */}
                    <div className={cn(
                        "absolute left-0 top-0 h-full w-1.5",
                        healthScore >= 70 ? "bg-green-500" : healthScore >= 40 ? "bg-amber-500" : "bg-red-500"
                    )} />
                    
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex flex-wrap justify-center md:justify-start gap-4 sm:gap-8 flex-1">
                            <div className="text-center md:text-left">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Puntos Correctos</p>
                                <div className="flex items-center justify-center md:justify-start gap-2 mt-0.5">
                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                    <span className="text-2xl font-bold text-slate-700">{okItemsCount}</span>
                                </div>
                            </div>

                            <div className="hidden sm:block h-10 w-px bg-slate-100 mt-2" />

                            <div className="text-center md:text-left">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Gravedad / Fallos</p>
                                <div className="flex items-center justify-center md:justify-start gap-2 mt-0.5">
                                    <XCircle className="h-5 w-5 text-red-500" />
                                    <span className="text-2xl font-bold text-slate-700">{failedItemsCount}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-center md:items-end pr-0 md:pr-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Puntuación de Salud</p>
                            <div className="flex items-baseline gap-1">
                                <span className={cn(
                                    "text-5xl font-black tracking-tighter leading-none transition-colors duration-700",
                                    healthScore >= 70 ? "text-green-600" : healthScore >= 40 ? "text-amber-600" : "text-red-600"
                                )}>
                                    {healthScore}
                                </span>
                                <span className="text-xl font-bold text-slate-400">%</span>
                            </div>
                        </div>

                        <Button
                            size="lg"
                            onClick={onComplete}
                            disabled={!isComplete}
                            className={cn(
                                "w-full md:w-auto px-10 py-7 text-lg font-bold rounded-xl shadow-lg transition-all",
                                isComplete 
                                    ? "bg-slate-900 border-none hover:bg-black hover:scale-[1.03] active:scale-95" 
                                    : "bg-slate-100 text-slate-400 border-slate-200"
                            )}
                        >
                            <CheckCircle2 className="mr-2 h-6 w-6 text-green-400" />
                            Finalizar 360°
                        </Button>
                    </div>
                </div>
                
                {!isComplete && (
                    <div className="flex items-center justify-center gap-2 text-xs text-amber-600 font-semibold animate-in slide-in-from-bottom-2">
                        <AlertCircle className="h-3 w-3" />
                        <span>Faltan {(totalPoints - completedPoints)} puntos por inspeccionar para poder confirmar</span>
                    </div>
                )}
            </div>
        </div>
    );
}
