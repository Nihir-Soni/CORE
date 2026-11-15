import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@core/storage";

export async function downloadObjectBuffer(
  key: string
): Promise<Buffer> {
  const { Body } = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );

  if (!Body) {
    throw new Error("storage_object_empty");
  }

  const chunks: Buffer[] = [];

  for await (const chunk of Body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}