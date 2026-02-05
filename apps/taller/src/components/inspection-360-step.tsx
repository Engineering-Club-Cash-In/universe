import React, { useState, useMemo } from 'react';
import { useInspection } from '../contexts/InspectionContext';
import { INSPECTION_AREAS } from '../lib/inspection-data';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Activity } from 'lucide-react';
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

    const handleStatusChange = (category: string, itemLabel: string, status: 'ok' | 'fail') => {
        setItems360(prev => {
            const existingIndex = prev.findIndex(i => i.item === itemLabel && i.category === category);

            if (existingIndex >= 0) {
                const newItems = [...prev];
                newItems[existingIndex] = {
                    ...newItems[existingIndex],
                    status,
                    observation: status === 'ok' ? undefined : newItems[existingIndex].observation
                };
                return newItems;
            } else {
                return [...prev, { category, item: itemLabel, status }];
            }
        });
    };

    const handleObservationChange = (category: string, itemLabel: string, observation: string) => {
        setItems360(prev => {
            const existingIndex = prev.findIndex(i => i.item === itemLabel && i.category === category);
            if (existingIndex >= 0) {
                const newItems = [...prev];
                newItems[existingIndex] = { ...newItems[existingIndex], observation };
                return newItems;
            }
            return prev;
        });
    };

    const getItemState = (category: string, itemLabel: string) => {
        return items360.find(i => i.category === category && i.item === itemLabel);
    };

    const totalPoints = useMemo(() => INSPECTION_AREAS.reduce((acc, area) => acc + area.points.length, 0), []);
    const completedPoints = items360.length;
    const progressPercentage = Math.round((completedPoints / totalPoints) * 100);
    const isComplete = completedPoints === totalPoints;
    const failedItemsCount = items360.filter(i => i.status === 'fail').length;

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
                        <CardTitle className="text-lg">Resumen de Estado</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-4">
                            <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle2 className="h-5 w-5" />
                                <span className="font-bold">{items360.filter(i => i.status === 'ok').length}</span> OK
                            </div>
                            <div className="flex items-center gap-2 text-red-600">
                                <XCircle className="h-5 w-5" />
                                <span className="font-bold">{failedItemsCount}</span> Fallos
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Controles de Expansión */}
            <div className="flex justify-end gap-2">
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
                    const areaFails = areaItems.filter(i => i.status === 'fail').length;
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
                                        <Badge variant="destructive" className="gap-1 flex items-center">
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
                                        const isOk = state?.status === 'ok';
                                        const isFail = state?.status === 'fail';

                                        return (
                                            <div key={point.id} className={cn(
                                                "p-3 rounded-md border transition-all duration-200",
                                                isFail ? "bg-red-50 border-red-200" :
                                                    isOk ? "bg-green-50 border-green-200" : "bg-slate-50/50 border-slate-100"
                                            )}>
                                                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                                                    <div className="flex-1">
                                                        <Label htmlFor={`btn-${point.id}`} className="text-sm font-medium text-slate-700 cursor-pointer">
                                                            {point.label}
                                                        </Label>
                                                    </div>

                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <Button
                                                            variant={isOk ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, 'ok')}
                                                            className={cn(
                                                                "h-8 px-3 gap-1.5 min-w-[80px]",
                                                                isOk ? "bg-green-600 hover:bg-green-700 text-white" : "text-green-700 border-green-200 hover:bg-green-50"
                                                            )}
                                                        >
                                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                                            OK
                                                        </Button>
                                                        <Button
                                                            variant={isFail ? "destructive" : "outline"}
                                                            size="sm"
                                                            onClick={() => handleStatusChange(area.id, point.label, 'fail')}
                                                            className={cn(
                                                                "h-8 px-3 gap-1.5 min-w-[80px]",
                                                                isFail ? "" : "text-red-700 border-red-200 hover:bg-red-50"
                                                            )}
                                                        >
                                                            <XCircle className="h-3.5 w-3.5" />
                                                            Fallo
                                                        </Button>
                                                    </div>
                                                </div>

                                                {isFail && (
                                                    <div className="mt-3 pl-0 sm:pl-3 border-l-0 sm:border-l-2 border-red-200 animate-in slide-in-from-top-1 fade-in duration-200">
                                                        <Textarea
                                                            placeholder="Describa el problema encontrado (ej. Fuga visible, pieza rota)..."
                                                            value={state?.observation || ''}
                                                            onChange={(e) => handleObservationChange(area.id, point.label, e.target.value)}
                                                            className="min-h-[60px] bg-white border-red-200 focus-visible:ring-red-500 text-sm resize-none"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    );
                })}
            </div>

            <div className="flex justify-end pt-6">
                <Button
                    size="lg"
                    onClick={onComplete}
                    disabled={!isComplete}
                    className="w-full sm:w-auto gap-2"
                >
                    Continuar a Checklist
                    <ChevronDown className="h-4 w-4 rotate-270" style={{ transform: 'rotate(-90deg)' }} />
                </Button>
            </div>
        </div>
    );
}
