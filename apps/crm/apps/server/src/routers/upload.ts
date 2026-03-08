import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { crmProcedure } from "../lib/orpc";
import {
	UPLOAD_RESOURCE_TYPES,
	buildUploadPrefix,
	generatePresignedUploadUrl,
	generateUniqueFilename,
	validateResolvedMimeType,
} from "../lib/storage";

export const uploadRouter = {
	getUploadPresignedUrl: crmProcedure
		.input(
			z.object({
				filename: z.string().min(1),
				mimeType: z.string().optional(),
				resourceType: z.enum(UPLOAD_RESOURCE_TYPES),
				resourceId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const resolvedMime = validateResolvedMimeType({
				name: input.filename,
				type: input.mimeType,
			});

			if (!resolvedMime.valid || !resolvedMime.mimeType) {
				throw new ORPCError("BAD_REQUEST", {
					message: resolvedMime.error || "Tipo de archivo no permitido",
				});
			}

			const prefix = buildUploadPrefix(input.resourceType, input.resourceId);
			const uniqueFilename = generateUniqueFilename(input.filename);
			const key = `${prefix}/${uniqueFilename}`;
			const url = await generatePresignedUploadUrl(key, resolvedMime.mimeType);

			return { url, key, resolvedMimeType: resolvedMime.mimeType };
		}),
};
