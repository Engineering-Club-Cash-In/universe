import { useMutation, useQuery } from "@tanstack/react-query";
import {
	Check,
	Clock,
	Copy,
	ExternalLink,
	Loader2,
	Phone,
	Send,
	User,
	Users,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client, orpc, queryClient } from "@/utils/orpc";

function WhatsAppIcon({ className }: { className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 18 18"
			fill="currentColor"
			className={className}
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M14.9504 2.54301C14.1414 1.73366 13.1804 1.09231 12.1226 0.655881C11.0647 0.219451 9.93103-0.00344001 8.78672 4.01327e-05C3.98438 4.01327e-05 0.075 3.88988 0.0730468 8.67192C0.0709224 10.1946 0.472303 11.6907 1.23633 13.0079L0 17.5 4.61914 16.2942C5.89774 16.9869 7.32903 17.3494 8.7832 17.3489H8.78672C13.5887 17.3489 17.4977 13.4586 17.5 8.67699C17.5029 7.53659 17.279 6.40699 16.8413 5.35392 16.4036 4.30086 15.7608 3.34535 14.9504 2.54301ZM8.78672 15.8852H8.78359C7.48726 15.8856 6.21449 15.5387 5.09766 14.8805L4.8332 14.7243 2.09219 15.4399 2.82383 12.7801 2.65156 12.5067C1.92671 11.3591 1.54267 10.0293 1.54414 8.67192 1.54414 4.69809 4.79453 1.46488 8.78945 1.46488 10.7059 1.46146 12.5451 2.21939 13.9028 3.57196 15.2604 4.92454 16.0252 6.76098 16.0289 8.67738 16.0273 12.6516 12.7785 15.8852 8.78672 15.8852ZM12.759 10.4872C12.5414 10.3786 11.4699 9.85434 11.2715 9.78207 11.073 9.70981 10.9266 9.67348 10.7816 9.89067 10.6367 10.1079 10.2191 10.5938 10.0922 10.7403 9.96523 10.8868 9.83828 10.9028 9.6207 10.7942 9.40313 10.6856 8.70117 10.4571 7.86953 9.71879 7.22227 9.14418 6.78555 8.43481 6.65859 8.21801 6.53164 8.00121 6.64492 7.88363 6.75391 7.77582 6.85195 7.67856 6.97148 7.5227 7.08047 7.39613 7.18945 7.26957 7.22578 7.17895 7.29805 7.03442 7.37031 6.88988 7.33437 6.76332 7.28008 6.65512 7.22578 6.54691 6.79023 5.48012 6.60898 5.04613 6.43203 4.62348 6.25273 4.6809 6.11914 4.67426 5.99219 4.66801 5.8457 4.66645 5.70156 4.66645 5.59137 4.66931 5.48295 4.69487 5.38308 4.74151 5.28321 4.78816 5.19402 4.85489 5.12109 4.93754 4.92148 5.15473 4.35898 5.67973 4.35898 6.74535 4.35898 7.81098 5.14023 8.84223 5.24805 8.98676 5.35586 9.13129 6.7832 11.32 8.96719 12.2586 9.37273 12.4323 9.7871 12.5846 10.2086 12.7149 10.7301 12.8797 11.2047 12.8567 11.5797 12.8008 11.998 12.7387 12.8688 12.2766 13.0496 11.7704 13.2305 11.2641 13.2309 10.8305 13.1766 10.7403 13.1223 10.65 12.977 10.5954 12.759 10.4872Z"
			/>
		</svg>
	);
}

interface WhatsappLogBadgeProps {
	opportunityId: string;
	leadId: string;
}

export function WhatsappLogBadge({
	opportunityId,
	leadId,
}: WhatsappLogBadgeProps) {
	const [modalOpen, setModalOpen] = useState(false);

	const logQuery = useQuery({
		...orpc.getWhatsappLog.queryOptions({
			input: { opportunityId },
		}),
	});

	const log = logQuery.data as WhatsappLog | null | undefined;

	if (logQuery.isLoading) {
		return (
			<Badge variant="outline" className="text-xs">
				<Loader2 className="mr-1 h-3 w-3 animate-spin" />
				WhatsApp
			</Badge>
		);
	}

	// No hay log todavía
	if (!log) {
		return null;
	}

	const allSent = log.recipients.every((r) => r.status === "sent");
	const somePending = log.recipients.some((r) => r.status === "pending");

	if (allSent) {
		return (
			<Badge
				variant="outline"
				className="border-[#25D366] bg-[#25D366]/10 text-[#128C7E] text-xs"
			>
				<WhatsAppIcon className="mr-1 h-3 w-3" />
				Contratos enviados
			</Badge>
		);
	}

	return (
		<>
			<Badge
				variant="outline"
				className="cursor-pointer border-[#25D366] bg-amber-50 text-[#128C7E] text-xs hover:bg-amber-100"
				onClick={(e) => {
					e.stopPropagation();
					setModalOpen(true);
				}}
			>
				<WhatsAppIcon className="mr-1 h-3 w-3" />
				Contratos pendientes de enviar
			</Badge>

			<WhatsappLogModal
				open={modalOpen}
				onOpenChange={setModalOpen}
				log={log}
			/>
		</>
	);
}

interface WhatsappLogRecipient {
	id: string;
	whatsappLogId: string;
	leadId: string | null;
	coDebtorId: string | null;
	recipientName: string;
	phone: string | null;
	message: string | null;
	contracts: { contractName: string; link: string | null; pdfLink?: string | null }[] | null;
	status: "sent" | "pending" | "failed";
	reason: string | null;
	sentAt: string | null;
	createdAt: string;
	updatedAt: string;
}

interface WhatsappLog {
	id: string;
	opportunityId: string;
	createdAt: string;
	updatedAt: string;
	recipients: WhatsappLogRecipient[];
}

function WhatsappLogModal({
	open,
	onOpenChange,
	log,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	log: WhatsappLog;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-h-[85vh] w-[90vw] sm:max-w-[900px] overflow-y-auto"
				onClick={(e) => e.stopPropagation()}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<WhatsAppIcon className="h-5 w-5 text-[#25D366]" />
						Envío de contratos por WhatsApp
					</DialogTitle>
					<DialogDescription>
						Gestiona el envío de links de contratos a cada
						destinatario.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{log.recipients.map((recipient) => (
						<RecipientCard
							key={recipient.id}
							recipient={recipient}
						/>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}

type Recipient = WhatsappLog["recipients"][number];

function RecipientCard({
	recipient,
}: {
	recipient: Recipient;
}) {
	const [editing, setEditing] = useState(false);
	const [phone, setPhone] = useState(recipient.phone ?? "");

	const recipientContracts = (recipient.contracts ?? []) as {
		contractName: string;
		link: string | null;
		pdfLink?: string | null;
	}[];

	const [contractLinks, setContractLinks] = useState<
		Record<number, string>
	>(() => {
		const initial: Record<number, string> = {};
		for (let i = 0; i < recipientContracts.length; i++) {
			initial[i] = recipientContracts[i].link ?? "";
		}
		return initial;
	});

	const currentContracts = recipientContracts.map((c, i) => ({
		contractName: c.contractName,
		link: contractLinks[i]?.trim() || null,
	}));

	const allLinksComplete = currentContracts.every((c) => c.link);

	// Generar preview del mensaje
	const previewMessage = allLinksComplete
		? `Hola ${recipient.recipientName}, tus contratos están listos para firmar. Por favor ingresa a los siguientes enlaces:\n\n${currentContracts.map((c) => `📄 ${c.contractName}:\n${c.link}`).join("\n\n")}\n\nSi tienes alguna duda, no dudes en contactarnos.`
		: null;

	const updateMutation = useMutation({
		mutationFn: async () => {
			return await client.updateWhatsappLog({
				recipientId: recipient.id,
				phone,
				contracts: currentContracts,
			});
		},
		onSuccess: (data) => {
			if (data.status === "sent") {
				toast.success(
					`Mensaje enviado a ${recipient.recipientName}`,
				);
			} else {
				toast.error(
					`Error al enviar: ${data.reason || "Error desconocido"}`,
				);
			}
			setEditing(false);
			queryClient.invalidateQueries({
				predicate: (query) =>
					JSON.stringify(query.queryKey).includes("getWhatsappLog"),
			});
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al enviar");
		},
	});

	const isLead = !!recipient.leadId;
	const isSent = recipient.status === "sent";

	return (
		<div className="rounded-lg border p-4 space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					{isLead ? (
						<User className="h-4 w-4 text-blue-600" />
					) : (
						<Users className="h-4 w-4 text-purple-600" />
					)}
					<span className="font-medium text-sm">
						{recipient.recipientName}
					</span>
					<Badge
						variant="outline"
						className={`text-xs ${isLead ? "border-blue-200 text-blue-600" : "border-purple-200 text-purple-600"}`}
					>
						{isLead ? "Cliente" : "Cofirmante"}
					</Badge>
				</div>
				<StatusBadge status={recipient.status} />
			</div>

			{recipient.reason && !isSent && (
				<p className="text-muted-foreground text-xs italic">
					{recipient.reason}
				</p>
			)}

			{isSent ? (
				<div className="space-y-2">
					{recipient.phone && (
						<p className="flex items-center gap-1 text-muted-foreground text-xs">
							<Phone className="h-3 w-3" />
							{recipient.phone}
						</p>
					)}
					{recipient.sentAt && (
						<p className="text-muted-foreground text-xs">
							Enviado:{" "}
							{new Date(recipient.sentAt).toLocaleString(
								"es-GT",
							)}
						</p>
					)}
					{recipientContracts.length > 0 && (
						<div className="space-y-1 pt-1">
							{recipientContracts.map((c, i) => (
								<p
									key={i}
									className="text-muted-foreground text-xs truncate"
								>
									📄 {c.contractName}
								</p>
							))}
						</div>
					)}
				</div>
			) : editing ? (
				<div className="space-y-3">
					<div className="space-y-1">
						<Label className="text-xs">Teléfono</Label>
						<Input
							value={phone}
							onChange={(e) => setPhone(e.target.value)}
							placeholder="+502XXXXXXXX"
						/>
					</div>

					<div className="space-y-2">
						<Label className="text-xs">
							Links de firma por contrato
						</Label>
						{recipientContracts.map((c, i) => (
							<div key={i} className="space-y-1">
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground text-xs">
										📄 {c.contractName}
									</span>
									{c.pdfLink && (
										<a
											href={c.pdfLink}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1 text-blue-600 text-xs hover:underline"
											onClick={(e) =>
												e.stopPropagation()
											}
										>
											<ExternalLink className="h-3 w-3" />
											PDF
										</a>
									)}
								</div>
								<Input
									value={contractLinks[i] ?? ""}
									onChange={(e) =>
										setContractLinks((prev) => ({
											...prev,
											[i]: e.target.value,
										}))
									}
									placeholder="Pegar link de firma aquí..."
									className={`text-xs ${contractLinks[i]?.trim() ? "border-green-300" : "border-amber-300"}`}
								/>
							</div>
						))}
					</div>

					{previewMessage && (
						<div className="space-y-1">
							<Label className="text-xs">
								Vista previa del mensaje
							</Label>
							<div className="rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
								{previewMessage}
							</div>
							<Button
								size="sm"
								variant="outline"
								className="w-full"
								onClick={() => {
									navigator.clipboard.writeText(
										previewMessage,
									);
									toast.success(
										"Mensaje copiado al portapapeles",
									);
								}}
							>
								<Copy className="mr-1 h-3 w-3" />
								Copiar mensaje
							</Button>
						</div>
					)}

					<div className="flex gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => setEditing(false)}
							className="flex-1"
						>
							Cancelar
						</Button>
						<Button
							size="sm"
							onClick={() => updateMutation.mutate()}
							disabled={
								updateMutation.isPending ||
								!phone.trim() ||
								!allLinksComplete
							}
							className="flex-1"
						>
							{updateMutation.isPending ? (
								<Loader2 className="mr-1 h-3 w-3 animate-spin" />
							) : (
								<Send className="mr-1 h-3 w-3" />
							)}
							Enviar por WhatsApp
						</Button>
					</div>
				</div>
			) : (
				<Button
					size="sm"
					variant="outline"
					onClick={() => setEditing(true)}
					className="w-full"
				>
					<WhatsAppIcon className="mr-1 h-3 w-3" />
					Enviar manualmente
				</Button>
			)}
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	switch (status) {
		case "sent":
			return (
				<Badge
					variant="outline"
					className="border-green-300 bg-green-50 text-green-700 text-xs"
				>
					<Check className="mr-1 h-3 w-3" />
					Enviado
				</Badge>
			);
		case "failed":
			return (
				<Badge
					variant="outline"
					className="border-red-300 bg-red-50 text-red-700 text-xs"
				>
					<XCircle className="mr-1 h-3 w-3" />
					Fallido
				</Badge>
			);
		default:
			return (
				<Badge
					variant="outline"
					className="border-amber-300 bg-amber-50 text-amber-700 text-xs"
				>
					<Clock className="mr-1 h-3 w-3" />
					Pendiente
				</Badge>
			);
	}
}
