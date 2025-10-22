import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	Bell,
	Edit2,
	MessageCircle,
	Pin,
	PinOff,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc } from "@/utils/orpc";

type EntityType =
	| "lead"
	| "opportunity"
	| "client"
	| "company"
	| "vehicle"
	| "vendor"
	| "contract"
	| "collection_case";

type NoteType = "general" | "follow_up" | "important" | "internal";

interface NotesTimelineProps {
	entityType: EntityType;
	entityId: string;
	title?: string;
}

const noteTypeLabels: Record<NoteType, string> = {
	general: "General",
	follow_up: "Seguimiento",
	important: "Importante",
	internal: "Interna",
};

const noteTypeIcons: Record<NoteType, React.ReactNode> = {
	general: <MessageCircle className="h-4 w-4" />,
	follow_up: <Bell className="h-4 w-4" />,
	important: <AlertCircle className="h-4 w-4" />,
	internal: <MessageCircle className="h-4 w-4" />,
};

const noteTypeColors: Record<NoteType, string> = {
	general: "bg-gray-100 text-gray-800",
	follow_up: "bg-blue-100 text-blue-800",
	important: "bg-red-100 text-red-800",
	internal: "bg-yellow-100 text-yellow-800",
};

export function NotesTimeline({
	entityType,
	entityId,
	title = "Notas",
}: NotesTimelineProps) {
	const [newNote, setNewNote] = useState("");
	const [noteType, setNoteType] = useState<NoteType>("general");
	const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
	const [editingContent, setEditingContent] = useState("");

	const queryClient = useQueryClient();

	// Query para obtener las notas
	const notesQuery = useQuery({
		...orpc.getEntityNotes.queryOptions({
			input: { entityType, entityId },
		}),
	});

	// Mutation para crear nota
	const createNoteMutation = useMutation({
		mutationFn: (data: {
			content: string;
			noteType: NoteType;
			isPinned: boolean;
		}) =>
			client.createNote({
				entityType,
				entityId,
				content: data.content,
				noteType: data.noteType,
				isPinned: data.isPinned,
			}),
		onSuccess: () => {
			toast.success("Nota creada exitosamente");
			setNewNote("");
			setNoteType("general");
			queryClient.invalidateQueries({
				queryKey: orpc.getEntityNotes.queryKey({
					input: { entityType, entityId },
				}),
			});
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al crear la nota");
		},
	});

	// Mutation para actualizar nota
	const updateNoteMutation = useMutation({
		mutationFn: (data: { noteId: string; content: string }) =>
			client.updateNote({
				noteId: data.noteId,
				content: data.content,
			}),
		onSuccess: () => {
			toast.success("Nota actualizada exitosamente");
			setEditingNoteId(null);
			setEditingContent("");
			queryClient.invalidateQueries({
				queryKey: orpc.getEntityNotes.queryKey({
					input: { entityType, entityId },
				}),
			});
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al actualizar la nota");
		},
	});

	// Mutation para alternar pin
	const togglePinMutation = useMutation({
		mutationFn: (data: { noteId: string; isPinned: boolean }) =>
			client.togglePinNote({
				noteId: data.noteId,
				isPinned: !data.isPinned,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.getEntityNotes.queryKey({
					input: { entityType, entityId },
				}),
			});
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al fijar la nota");
		},
	});

	// Mutation para eliminar nota
	const deleteNoteMutation = useMutation({
		mutationFn: (noteId: string) => client.deleteNote({ noteId }),
		onSuccess: () => {
			toast.success("Nota eliminada exitosamente");
			queryClient.invalidateQueries({
				queryKey: orpc.getEntityNotes.queryKey({
					input: { entityType, entityId },
				}),
			});
		},
		onError: (error: any) => {
			toast.error(error.message || "Error al eliminar la nota");
		},
	});

	const handleCreateNote = () => {
		if (!newNote.trim()) {
			toast.error("El contenido de la nota no puede estar vacío");
			return;
		}

		createNoteMutation.mutate({
			content: newNote.trim(),
			noteType,
			isPinned: false,
		});
	};

	const handleUpdateNote = (noteId: string) => {
		if (!editingContent.trim()) {
			toast.error("El contenido de la nota no puede estar vacío");
			return;
		}

		updateNoteMutation.mutate({
			noteId,
			content: editingContent.trim(),
		});
	};

	const startEditing = (noteId: string, currentContent: string) => {
		setEditingNoteId(noteId);
		setEditingContent(currentContent);
	};

	const cancelEditing = () => {
		setEditingNoteId(null);
		setEditingContent("");
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-lg">
					<MessageCircle className="h-5 w-5" />
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Formulario para crear nueva nota */}
				<div className="space-y-3 rounded-lg bg-muted/50 p-4">
					<div className="space-y-2">
						<Label htmlFor="noteType">Tipo de Nota</Label>
						<Select
							value={noteType}
							onValueChange={(value) => setNoteType(value as NoteType)}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(noteTypeLabels).map(([value, label]) => (
									<SelectItem key={value} value={value}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="newNote">Nueva Nota</Label>
						<Textarea
							id="newNote"
							value={newNote}
							onChange={(e) => setNewNote(e.target.value)}
							placeholder="Escribe una nota..."
							rows={3}
						/>
					</div>

					<Button
						onClick={handleCreateNote}
						disabled={createNoteMutation.isPending || !newNote.trim()}
						className="w-full"
					>
						{createNoteMutation.isPending ? "Guardando..." : "Agregar Nota"}
					</Button>
				</div>

				{/* Timeline de notas */}
				<div className="space-y-3">
					{notesQuery.isLoading && (
						<p className="py-4 text-center text-muted-foreground">
							Cargando notas...
						</p>
					)}

					{notesQuery.data?.length === 0 && (
						<Alert>
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>No hay notas registradas aún.</AlertDescription>
						</Alert>
					)}

					{notesQuery.data?.map((note) => (
						<div
							key={note.id}
							className={`space-y-2 rounded-lg border p-4 ${
								note.isPinned ? "border-primary bg-primary/5" : ""
							}`}
						>
							<div className="flex items-start justify-between gap-2">
								<div className="flex items-center gap-2">
									<Badge className={noteTypeColors[note.noteType]}>
										<span className="flex items-center gap-1">
											{noteTypeIcons[note.noteType]}
											{noteTypeLabels[note.noteType]}
										</span>
									</Badge>
									{note.isPinned && (
										<Badge variant="outline">
											<Pin className="mr-1 h-3 w-3" />
											Fijada
										</Badge>
									)}
								</div>

								<div className="flex items-center gap-1">
									<Button
										size="sm"
										variant="ghost"
										onClick={() =>
											togglePinMutation.mutate({
												noteId: note.id,
												isPinned: note.isPinned,
											})
										}
										disabled={togglePinMutation.isPending}
									>
										{note.isPinned ? (
											<PinOff className="h-4 w-4" />
										) : (
											<Pin className="h-4 w-4" />
										)}
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => startEditing(note.id, note.content)}
									>
										<Edit2 className="h-4 w-4" />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => deleteNoteMutation.mutate(note.id)}
										disabled={deleteNoteMutation.isPending}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</div>

							{editingNoteId === note.id ? (
								<div className="space-y-2">
									<Textarea
										value={editingContent}
										onChange={(e) => setEditingContent(e.target.value)}
										rows={3}
									/>
									<div className="flex gap-2">
										<Button
											size="sm"
											onClick={() => handleUpdateNote(note.id)}
											disabled={updateNoteMutation.isPending}
										>
											{updateNoteMutation.isPending
												? "Guardando..."
												: "Guardar"}
										</Button>
										<Button size="sm" variant="outline" onClick={cancelEditing}>
											Cancelar
										</Button>
									</div>
								</div>
							) : (
								<p className="whitespace-pre-wrap text-sm">{note.content}</p>
							)}

							<div className="text-muted-foreground text-xs">
								{new Date(note.createdAt).toLocaleString("es-GT", {
									dateStyle: "medium",
									timeStyle: "short",
								})}
								{note.editedBy && note.updatedAt !== note.createdAt && (
									<span className="ml-2">(editada)</span>
								)}
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
