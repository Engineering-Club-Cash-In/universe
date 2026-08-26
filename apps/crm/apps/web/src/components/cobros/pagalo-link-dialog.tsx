import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { client, orpc } from "@/utils/orpc";

const q = (value: unknown) =>
	new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(Number(value ?? 0));

export function PagaloLinkDialog({ casoCobroId, numeroSifco, creditoId }: { casoCobroId: string; numeroSifco: string; creditoId: number }) {
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState<number[]>([]);
	const credit = useQuery({ ...orpc.getCreditoParaPago.queryOptions({ input: { numeroSifco } }), enabled: open && !!numeroSifco });
	const data = credit.data as any;
	const cuotas = useMemo(() => {
		const sinDuplicados = (items: any[]) => {
			const porNumero = new Map<number, any>();
			for (const cuota of items) {
				const actual = porNumero.get(cuota.numero_cuota);
				if (!actual || Number(cuota.pago_id ?? 0) > Number(actual.pago_id ?? 0)) porNumero.set(cuota.numero_cuota, cuota);
			}
			return [...porNumero.values()];
		};
		const vencidas = sinDuplicados(data?.cuotasAtrasadas ?? [])
			.filter((cuota: any) => cuota.numero_cuota > 0)
			.sort((a: any, b: any) => a.numero_cuota - b.numero_cuota);
		const proxima = sinDuplicados(data?.cuotasPendientes ?? [])
			.filter((cuota: any) => cuota.numero_cuota > 0)
			.sort((a: any, b: any) => a.numero_cuota - b.numero_cuota)[0];
		return sinDuplicados(proxima ? [...vencidas, proxima] : vencidas);
	}, [data]);
	useEffect(() => {
		if (open && credit.isSuccess) setSelected(cuotas.map((cuota: any) => cuota.cuota_id));
	}, [open, credit.isSuccess, cuotas]);
	const tieneMora = Number(data?.moraActual ?? 0) > 0;
	const preview = useMemo(() => {
		const seleccionadas = cuotas.filter((cuota: any) => selected.includes(cuota.cuota_id));
		const capital = seleccionadas.reduce((sum: number, cuota: any) => sum + Number(cuota.capital_restante ?? 0), 0);
		const facturableCuotas = seleccionadas.reduce(
			(sum: number, cuota: any) =>
				sum +
				Number(cuota.interes_restante ?? 0) +
				Number(cuota.iva_12_restante ?? 0) +
				Number(cuota.seguro_restante ?? 0) +
				Number(cuota.gps_restante ?? 0) +
				Number(cuota.membresias_restante ?? 0),
			0,
		);
		const mora = tieneMora ? Number(data?.moraActual ?? 0) : 0;
		const facturable = facturableCuotas + mora;
		return { capital, facturable, total: capital + facturable };
	}, [cuotas, selected, tieneMora, data]);
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (input: { casoCobroId: string; numeroSifco: string; creditoId: number; cuotaIds: number[] }) =>
			(client as any).crearLinksPagalo(input),
		onSuccess: (result: any) => {
			queryClient.invalidateQueries(orpc.getPagaloHistorial.queryOptions({ input: { casoCobroId } }));
			if (result.status === "REVIEW_REQUIRED") toast.error("Grupo Págalo existente requiere revisión.");
			else if (result.origen === "BOT")
				toast.info("El cliente ya generó estos links desde WhatsApp; se muestran los mismos.");
			else toast.success(`Links Págalo listos: ${q(result.totalAmount)}`);
		},
		onError: (error: Error) => toast.error(error.message || "No se pudieron crear links Págalo"),
	});
	const links = mutation.data?.links ?? [];
	const reviewRequired = mutation.data?.status === "REVIEW_REQUIRED";
	const toggle = (id: number) => setSelected((current) => {
		const index = cuotas.findIndex((cuota: any) => cuota.cuota_id === id);
		if (index < 0) return current;
		return current.includes(id)
			? cuotas.slice(0, index).map((cuota: any) => cuota.cuota_id)
			: cuotas.slice(0, index + 1).map((cuota: any) => cuota.cuota_id);
	});
	const todasSeleccionadas = cuotas.length > 0 && selected.length === cuotas.length;
	const toggleTodas = () => setSelected(todasSeleccionadas ? [] : cuotas.map((cuota: any) => cuota.cuota_id));
	// PRUEBA: dispara un ciclo del poller Págalo a demanda, sin esperar el
	// setInterval de 5 min. Con poller+dispatch unificados, un solo click
	// alcanza para llevar un link pagado hasta COMPLETED. Borrar junto con
	// el procedure probarPollPagalo cuando el ciclo automático esté probado.
	const pollMutation = useMutation({
		mutationFn: () => (client as any).probarPollPagalo(),
		onSuccess: (result: any) => {
			queryClient.invalidateQueries(orpc.getPagaloHistorial.queryOptions({ input: { casoCobroId } }));
			console.log("[Págalo] resultado del poll:", result);
			toast.success(
				`Poll: ${result.pagados} pagado(s), ${result.errores} error(es). Dispatch: ${result.dispatchCompletados} completado(s), ${result.dispatchErrores} error(es). Revisa la consola.`,
			);
		},
		onError: (error: Error) => toast.error(error.message || "Falló correr el poll de Págalo"),
	});

	return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setSelected([]); mutation.reset(); } }}>
		<DialogTrigger asChild><Button variant="outline" className="gap-2"><CreditCard className="h-4 w-4 text-violet-600" />Generar links Págalo</Button></DialogTrigger>
		<DialogContent className="flex max-h-[90vh] max-w-lg flex-col overflow-hidden">
			<DialogHeader><DialogTitle>Links de pago Págalo</DialogTitle><DialogDescription>Sandbox. Capital y mora/intereses salen en links separados. Links no expiran.</DialogDescription></DialogHeader>
			<Button type="button" variant="secondary" size="sm" className="w-fit" disabled={pollMutation.isPending} onClick={() => pollMutation.mutate()}>
				{pollMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
				Correr poll Págalo ahora (temporal)
			</Button>
			{credit.isLoading ? <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div> : links.length > 0 ? <div className="space-y-3">
					<p className="text-sm">{reviewRequired ? "Grupo existente en revisión. No se creó un link adicional:" : "Grupo creado. Comparte solo links necesarios:"}</p>
				{links.map((link: any) => <a key={link.linkType} href={link.paymentUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted"><span>{link.linkType === "CAPITAL" ? "Capital" : "Mora e intereses"}</span><ExternalLink className="h-4 w-4" /></a>)}
			</div> : <div className="min-h-0 space-y-3">
					<div className="flex items-center justify-between"><p className="text-sm font-medium">Cuotas seleccionables</p><div className="flex items-center gap-2"><span className="text-muted-foreground text-xs">{selected.length + (tieneMora ? 1 : 0)} seleccionada(s)</span>{cuotas.length > 0 && <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={toggleTodas}>{todasSeleccionadas ? "Desmarcar todas" : "Marcar todas"}</Button>}</div></div>
				{tieneMora && <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"><span className="flex items-center gap-3"><Checkbox checked disabled />Mora actual</span><span className="text-sm">{q(data.moraActual)}</span></div>}
				{cuotas.length === 0 ? <p className="text-muted-foreground text-sm">No hay cuotas vencidas disponibles.</p> : <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-2">{cuotas.map((cuota: any) => {
						const facturableCuota =
							Number(cuota.interes_restante ?? 0) +
							Number(cuota.iva_12_restante ?? 0) +
							Number(cuota.seguro_restante ?? 0) +
							Number(cuota.gps_restante ?? 0) +
							Number(cuota.membresias_restante ?? 0);
						const saldoCuota = Number(cuota.capital_restante ?? 0) + facturableCuota;
						const nominalCuota = Number(cuota.cuota ?? 0);
						// Cuota nominal vs saldo real: si hubo un abono parcial previo a
						// esta misma cuota, el link solo cubre lo que falta (saldoCuota),
						// no el monto nominal completo — mostrar ambos evita que parezca
						// que el link está incompleto (caso crédito 752, cuota 28: abono
						// previo de Q78.24 a interés dejó nominal Q1695.91 vs saldo real
						// Q1617.67).
						const yaAbonado = nominalCuota - saldoCuota;
						return <Label key={cuota.cuota_id} className="flex cursor-pointer items-center justify-between rounded-md border p-3"><span className="flex items-center gap-3"><Checkbox checked={selected.includes(cuota.cuota_id)} onCheckedChange={() => toggle(cuota.cuota_id)} />Cuota {cuota.numero_cuota}</span><span className="text-right text-muted-foreground text-sm"><span className="block">Capital {q(cuota.capital_restante)} · Mora e intereses {q(facturableCuota)}</span>{yaAbonado > 0.01 && <span className="block text-xs">Cuota nominal {q(nominalCuota)} − ya abonado {q(yaAbonado)} = saldo {q(saldoCuota)}</span>}</span></Label>;
					})}</div>}
				{(selected.length > 0 || tieneMora) && <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
					<p className="font-medium">Links que se van a crear</p>
					{preview.capital > 0 && <div className="flex items-center justify-between"><span>Link Capital</span><span>{q(preview.capital)}</span></div>}
					{preview.facturable > 0 && <div className="flex items-center justify-between"><span>Link Mora e intereses</span><span>{q(preview.facturable)}</span></div>}
					<div className="flex items-center justify-between border-t pt-1 font-medium"><span>Total</span><span>{q(preview.total)}</span></div>
				</div>}
			</div>}
			{links.length === 0 && <DialogFooter><Button disabled={(!tieneMora && selected.length === 0) || mutation.isPending} onClick={() => mutation.mutate({ casoCobroId, numeroSifco, creditoId, cuotaIds: selected })}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Crear links sandbox</Button></DialogFooter>}
		</DialogContent>
	</Dialog>;
}
