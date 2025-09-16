import {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand,
} from "@aws-sdk/client-rekognition";
import { db } from "../db";
import { leads, magicUrls, renapInfo } from "@/db/schema";
import { eq } from "drizzle-orm";
const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const livenessController = {
  /**
   * Crear una sesión de Face Liveness
   */
  async createLivenessSession() {
    try {
      const command = new CreateFaceLivenessSessionCommand({});
      const response = await rekognition.send(command);

      if (!response.SessionId) {
        return { success: false, message: "Failed to create session" };
      }

      console.log("[DEBUG] Created liveness session:", response.SessionId);

      return { success: true, sessionId: response.SessionId };
    } catch (err: any) {
      console.error("[ERROR] createLivenessSession:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  },

  /**
   * Validar la sesión contra la foto RENAP
   */
  async validateLivenessSession(sessionId: string, userDpi: string) {
    try {
      // 1. Obtener estado de la sesión
      const resultsCmd = new GetFaceLivenessSessionResultsCommand({
        SessionId: sessionId,
      });
      const results = await rekognition.send(resultsCmd);

      if (results.Status !== "SUCCEEDED") {
        return {
          success: false,
          message: `Session status is ${results.Status}`,
        };
      }

      // 2. Buscar foto RENAP
      const [user] = await db
        .select({
          leadId: leads.id,
          dpi: renapInfo.dpi,
          picture: renapInfo.picture,
        })
        .from(renapInfo)
        .innerJoin(leads, eq(renapInfo.dpi, leads.dpi))
        .where(eq(renapInfo.dpi, userDpi))
        .limit(1);
      if (!user?.picture) {
        return {
          success: false,
          message: "No RENAP picture found for this DPI",
        };
      }

      // ⚠️ Descargar la foto desde la URL almacenada en picture
      const renapPhotoBuffer = Buffer.from(
        await (await fetch(user.picture)).arrayBuffer()
      );

      // 3. Verificar referencia (nota: depende de OutputConfig en CreateFaceLivenessSession)
      if (!results.ReferenceImage) {
        return {
          success: false,
          message:
            "No reference image in liveness results (configure OutputConfig in S3)",
        };
      }

      // 4. Comparar las fotos
      const compareCmd = new CompareFacesCommand({
        SourceImage: { Bytes: results.ReferenceImage.Bytes }, // imagen capturada en liveness
        TargetImage: { Bytes: renapPhotoBuffer }, // foto oficial de RENAP
        SimilarityThreshold: 90,
      });

      const compareRes = await rekognition.send(compareCmd);
      const match = compareRes.FaceMatches?.[0];

      const isMatch = !!match && match.Similarity! >= 90;

      // ✅ 5. Si hay match, marcar magic_url como usado
      if (isMatch) {
        await db
          .update(magicUrls)
          .set({ used: true })
          .where(eq(magicUrls.leadId, user.leadId)); // asumiendo que renapInfo.dpi está ligado a lead
        console.log(`[DEBUG] Magic URL marcado como usado para DPI ${userDpi}`);
      }

      return {
        success: true,
        dpi: userDpi,
        sessionId,
        similarity: match?.Similarity || 0,
        isMatch,
      };
    } catch (err: any) {
      console.error("[ERROR] validateLivenessSession:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  },
};
