// twenty-upload.ts
import { readFile } from "fs/promises";
import { basename } from "path";
import { downloadFile } from "./supabase";

export async function uploadFileToTwenty(
  filePath: string,
  folder: string = "Attachment"
) {
  const fileBuffer = await readFile(filePath);
  const fileName = basename(filePath);

  const form = new FormData();

  // GraphQL operation (mutation)
  form.append(
    "operations",
    JSON.stringify({
      operationName: "uploadFile",
      variables: {
        file: null,
        fileFolder: folder,
      },
      query: `mutation uploadFile($file: Upload!, $fileFolder: FileFolder) {
        uploadFile(file: $file, fileFolder: $fileFolder)
      }`,
    })
  );

  // Mapping file to variable
  form.append("map", JSON.stringify({ "1": ["variables.file"] }));

  // Actual file content
  form.append("1", new Blob([fileBuffer]), fileName);

  const response = await fetch("https://crm.devteamatcci.site/graphql", {
    method: "POST",
    body: form,
    headers: {
      Authorization: `Bearer ${process.env.CRM_API_KEY}`,
    },
  });

  const result = await response.json();
  console.log("Upload result:", result);
  return result;
}
export async function uploadFromSupabaseUrl(fileUrl: string) {
  const res = await downloadFile(fileUrl);

  if (!res) {
    throw new Error(`Failed to download file from Supabase`);
  }

  const fileBuffer = await res.arrayBuffer();
  const fileName = (fileUrl.split("/").pop() || "file").split("?")[0];

  const form = new FormData();

  // GraphQL mutation
  form.append(
    "operations",
    JSON.stringify({
      operationName: "uploadFile",
      variables: {
        file: null,
        fileFolder: "Attachment",
      },
      query: `mutation uploadFile($file: Upload!, $fileFolder: FileFolder) {
          uploadFile(file: $file, fileFolder: $fileFolder)
        }`,
    })
  );

  // Mapping
  form.append("map", JSON.stringify({ "1": ["variables.file"] }));

  // File
  form.append("1", new Blob([fileBuffer]), fileName);

  const uploadRes = await fetch("https://crm.devteamatcci.site/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CRM_API_KEY}`,
    },
    body: form,
  });

  const result = await uploadRes.json();
  console.log("Upload result:", result);
  if (result.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
  }
  const url = result.data.uploadFile as string;
  return url.split("?")[0];
}
