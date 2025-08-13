import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";

const s3 = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  },
});

export async function uploadFileController({ request, set }: any) {
  const form = await request.formData();
  const file = form.get("file");

  if (!file || !(file instanceof Blob)) {
    set.status = 400;
    return { error: "No file uploaded" };
  }

  // Obtener extensión
  let ext = "";
  if ("name" in file) {
    const parts = (file as any).name.split(".");
    if (parts.length > 1) ext = "." + parts.pop();
  }
  const filename = `${uuidv4()}${ext}`;

  // Convertir Blob a Buffer
  const buffer = Buffer.from(await file.arrayBuffer());

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: filename,
      Body: buffer,
      ContentType: file.type || "application/octet-stream",
    })
  );

  const url = `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET}/${filename}`;
  return { success: true, url, filename };
}
