import { z } from "zod";
import { crmProcedure } from "../lib/orpc";
import {
	ALLOWED_DOCUMENT_TYPES,
	generatePresignedUploadUrl,
	generateUniqueFilename,
} from "../lib/storage";

export const uploadRouter = {
	getUploadPresignedUrl: crmProcedure
		.input(
			z.object({
				filename: z.string().min(1),
				mimeType: z
					.string()
					.refine((type) => ALLOWED_DOCUMENT_TYPES.includes(type), {
						message: "Tipo de archivo no permitido",
					}),
				folder: z.string().min(1),
			}),
		)
		.handler(async ({ input }) => {
			const uniqueFilename = generateUniqueFilename(input.filename);
			const key = `${input.folder}/${uniqueFilename}`;
			const url = await generatePresignedUploadUrl(key, input.mimeType);

			return { url, key };
		}),
};
