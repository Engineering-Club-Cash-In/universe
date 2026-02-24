import { useState, useMemo } from 'react';
import { useInspection } from '../contexts/InspectionContext';
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
    const { items360, setItems360 } = useInspection();

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
        const newItems: any[] = [];
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
        const statuses: ('bueno' | 'regular' | 'malo' | 'na')[] = ['bueno', 'bueno', 'bueno', 'bueno', 'regular', 'malo', 'na'];

        INSPECTION_AREAS.forEach(area => {
            area.points.forEach(point => {
                const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
                const isFail = randomStatus === 'malo' || randomStatus === 'regular';
                
                if (point.id === 'compresiones') {
                    newItems.push({
                        category: area.id,
                        item: point.label,
                        status: 'bueno',
                        metadata: {
                            cilindro_1: Math.floor(Math.random() * (150 - 110 + 1) + 110),
                            cilindro_2: Math.floor(Math.random() * (150 - 110 + 1) + 110),
                            cilindro_3: Math.floor(Math.random() * (150 - 110 + 1) + 110),
                            cilindro_4: Math.floor(Math.random() * (150 - 110 + 1) + 110),
                            cilindro_5: Math.floor(Math.random() * (150 - 110 + 1) + 110),
                            cilindro_6: Math.floor(Math.random() * (150 - 110 + 1) + 110),
                            cilindro_7: 0,
                            cilindro_8: 0,
                        }
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

    const handleStatusChange = (category: string, itemLabel: string, status: 'ok' | 'bad' | 'na' | 'bueno' | 'regular' | 'malo') => {
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
             setItems360([...existing, { category, item: itemLabel, status: 'na', notes }]);
        }
    };

    const handleMetadataChange = (category: string, itemLabel: string, metadataKey: string, metadataValue: any) => {
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
            setItems360([...existing, { category, item: itemLabel, status: 'bueno', metadata: { [metadataKey]: metadataValue } }]);
        }
    };

    const getItemState = (category: string, itemLabel: string) => {
        return items360.find(i => i.category === category && i.item === itemLabel);
    };

    const totalPoints = useMemo(() => INSPECTION_AREAS.reduce((acc, area) => acc + area.points.length, 0), []);
    const completedPoints = items360.length;
    const progressPercentage = Math.round((completedPoints / totalPoints) * 100);
    const isComplete = completedPoints === totalPoints;
    
    // Contamos como fallo todo lo que no sea 'bueno' ni 'na' o 'ok' para el resumen de fallos
    const failedItemsCount = items360.filter(i => ['bad', 'regular', 'malo'].includes(i.status)).length;
    const okItemsCount = items360.filter(i => ['ok', 'bueno', 'na'].includes(i.status)).length;

    // Calculamos el % de estado general del vehículo
    const calculateHealthScore = () => {
        if (items360.length === 0) return 0;
        
        // N/A no suma ni resta, se excluyen del cálculo base
        const countableItems = items360.filter(i => i.status !== 'na');
        if (countableItems.length === 0) return 100; // Si todo es N/A

        let totalScore = 0;
        countableItems.forEach(item => {
            if (item.status === 'ok' || item.status === 'bueno') {
                totalScore += 100;
            } else if (item.status === 'regular') {
                totalScore += 50; // Regular suma la mitad
            }
            // 'malo' o 'bad' suma 0
        });

        return Math.round(totalScore / countableItems.length);
    };

    const healthScore = calculateHealthScore();

    return (
        <div className="space-y-6 animate-in fade-in duration-500">

            {/* Resumen Superior */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg flex justify-between">
                            Progreso de Inspección
                            <Badge variant={isComplete ? "default" : "secondary"}>
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
                        <CardTitle className="text-lg flex justify-between">
                            Resumen de Estado
                            <Badge variant={healthScore >= 70 ? "default" : healthScore >= 40 ? "secondary" : "destructive"}>
                                Salud: {healthScore}%
                            </Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-4">
                            <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle2 className="h-5 w-5" />
                                <span className="font-bold">{okItemsCount}</span> OK / N/A
                            </div>
                            <div className="flex items-center gap-2 text-red-600">
                                <XCircle className="h-5 w-5" />
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
                    const areaFails = areaItems.filter(i => i.status === 'bad').length;
                    const isOpen = openSections[area.id];

                    return (
                        <Collapsible
                            key={area.id}
                            open={isOpen}
                            onOpenChange={() => toggleSection(area.id)}
                            className="border rounded-lg bg-white shadow-sm"
                        >
                            <div className="flex items-center justify-between p-4">
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost" className="p-0 hover:bg-transparent flex-1 justify-start h-auto font-normal">
                                        <div className="flex items-center gap-2 w-full">
                                            {isOpen ? (
                                                <ChevronDown className="h-5 w-5 text-slate-500" />
                                            ) : (
                                                <ChevronRight className="h-5 w-5 text-slate-500" />
                                            )}
                                            <span className="font-semibold text-lg text-slate-800">{area.title}</span>
                                        </div>
                                    </Button>
                                </CollapsibleTrigger>

                                <div className="flex items-center gap-3">
                                    {areaFails > 0 && (
                                        <Badge variant="secondary" className="gap-1 flex items-center bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200">
                                            <AlertCircle className="h-3 w-3" /> {areaFails}
                                        </Badge>
                                    )}
                                    <Badge variant={areaCompleted === areaTotal ? "outline" : "secondary"} className="text-xs">
                                        {areaCompleted}/{areaTotal}
                                    </Badge>
                                </div>
                            </div>

                            <CollapsibleContent>
                                <div className="px-4 pb-4 space-y-3 pt-0">
                                    <div className="h-px bg-slate-100 mb-4" /> {/* Separator */}

                                    {area.points.map((point) => {
                                        const state = getItemState(area.id, point.label);
                                        const isNa = state?.status === 'na';
                                        const isBueno = state?.status === 'bueno' || state?.status === 'ok'; // Fallback a ok
                                        const isRegular = state?.status === 'regular';
                                        const isMalo = state?.status === 'malo' || state?.status === 'bad'; // Fallback a bad
                                        
                                        const hasWarning = isRegular || isMalo;

                                        return (
                                            <div key={point.id} className={cn(
                                                "p-3 rounded-md border transition-all duration-200",
                                                "bg-white border-slate-200 hover:border-slate-300 flex flex-col gap-3"
                                            )}>
                                                <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-3">
                                                    <div className="flex-1">
                                                        <Label htmlFor={`btn-${point.id}`} className="text-sm font-medium text-slate-700 cursor-pointer">
                                                            {point.label}
                                                        </Label>
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                                                        {/* Nuevos botones: N/A, Bueno, Regular, Malo */}
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, 'na')}
                                                            className={cn(
                                                                "h-8 px-3 gap-1.5 min-w-[70px] transition-all",
                                                                isNa
                                                                    ? "bg-slate-200 text-slate-900 border-slate-400 font-medium hover:bg-slate-300"
                                                                    : "text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                                                            )}
                                                        >
                                                            <MinusCircle className={cn("h-3.5 w-3.5", isNa ? "text-slate-700" : "text-slate-400")} />
                                                            N/A
                                                        </Button>
                                                        
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, 'bueno')}
                                                            className={cn(
                                                                "h-8 px-3 gap-1.5 min-w-[80px] transition-all",
                                                                isBueno
                                                                    ? "bg-slate-200 text-slate-900 border-slate-400 font-medium hover:bg-slate-300"
                                                                    : "text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                                                            )}
                                                        >
                                                            <CheckCircle2 className={cn("h-3.5 w-3.5", isBueno ? "text-green-600" : "text-slate-400")} />
                                                            Bueno
                                                        </Button>

                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, 'regular')}
                                                            className={cn(
                                                                "h-8 px-3 gap-1.5 min-w-[80px] transition-all",
                                                                isRegular
                                                                    ? "bg-slate-200 text-slate-900 border-slate-400 font-medium hover:bg-slate-300"
                                                                    : "text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                                                            )}
                                                        >
                                                            <AlertTriangle className={cn("h-3.5 w-3.5", isRegular ? "text-amber-500" : "text-slate-400")} />
                                                            Regular
                                                        </Button>

                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, 'malo')}
                                                            className={cn(
                                                                "h-8 px-3 gap-1.5 min-w-[80px] transition-all",
                                                                isMalo
                                                                    ? "bg-slate-200 text-slate-900 border-slate-400 font-medium hover:bg-slate-300"
                                                                    : "text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                                                            )}
                                                        >
                                                            <XCircle className={cn("h-3.5 w-3.5", isMalo ? "text-red-600" : "text-slate-400")} />
                                                            Malo
                                                        </Button>
                                                    </div>
                                                </div>
                                                
                                                {/* Sección especial de compresiones */}
                                                {point.id === 'compresiones' && (
                                                    <div className="grid grid-cols-4 md:grid-cols-8 gap-2 bg-slate-50 p-3 rounded-md border border-slate-200">
                                                        <div className="col-span-4 md:col-span-8 mb-2">
                                                            <Label className="text-xs text-slate-500 font-semibold mb-1 uppercase text-center block w-full border-b pb-1">Tabla de Presión (PSI) por cilindro</Label>
                                                        </div>
                                                        {[1, 2, 3, 4, 5, 6, 7, 8].map(cyl => (
                                                            <div key={cyl} className="flex flex-col gap-1 items-center">
                                                                <Label className="text-[10px] text-muted-foreground">Cilindro {cyl}</Label>
                                                                <div className="relative">
                                                                    <input 
                                                                        type="number"
                                                                        min="0"
                                                                        placeholder="0"
                                                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-center font-mono"
                                                                        value={state?.metadata?.[`cilindro_${cyl}`] || ''}
                                                                        onChange={(e) => handleMetadataChange(area.id, point.label, `cilindro_${cyl}`, e.target.value)}
                                                                    />
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Textarea ahora siempre está disponible pero con highlight si hay un warning/malo */}
                                                <div className={cn("pl-0 sm:pl-3 w-full transition-all mt-1", hasWarning ? "border-l-2 border-amber-400" : "border-l-2 border-transparent")}>
                                                    <Textarea
                                                        placeholder={hasWarning ? "Por favor describa el problema encontrado..." : "Comentarios u observaciones adicionales (opcional)..."}
                                                        value={state?.notes || ''}
                                                        onChange={(e) => handleObservationChange(area.id, point.label, e.target.value)}
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

            <div className="flex justify-center pt-8">
                <Button
                    size="lg"
                    onClick={onComplete}
                    disabled={!isComplete}
                    className="w-full sm:w-auto gap-2 px-8 min-w-[200px]"
                >
                    <CheckCircle2 className="h-5 w-5" />
                    Confirmar y Continuar
                </Button>
            </div>
        </div>
    );
}
