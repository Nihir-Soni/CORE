import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, s3Presigner, BUCKET } from "./client.js";
import { Readable } from "node:stream";

export async function initiateMultipartUpload(key: string, contentType: string): Promise<{ uploadId: string }> {
  const command = new CreateMultipartUploadCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const response = await s3.send(command);
  
  if (!response.UploadId) {
    throw new Error("Failed to initiate multipart upload: No UploadId returned");
  }

  return { uploadId: response.UploadId };
}

export async function uploadPart(
  key: string, 
  uploadId: string, 
  partNumber: number, 
  body: Buffer | Readable | Uint8Array | string
): Promise<{ etag: string }> {
  if (partNumber < 1 || partNumber > 10000) {
    throw new Error(`Invalid part number: ${partNumber}. Must be between 1 and 10000.`);
  }

  const command = new UploadPartCommand({
    Bucket: BUCKET,
    Key: key,
    PartNumber: partNumber,
    UploadId: uploadId,
    Body: body,
  });

  const response = await s3.send(command);
  
  if (!response.ETag) {
    throw new Error(`Failed to upload part ${partNumber}: No ETag returned`);
  }

  return { etag: response.ETag.replace(/"/g, "") }; // Some S3 implementations return quoted ETags
}

export async function completeMultipartUpload(
  key: string, 
  uploadId: string, 
  parts: Array<{ partNumber: number; etag: string }>
): Promise<void> {
  if (!parts || parts.length === 0) {
    throw new Error("Cannot complete multipart upload with empty parts list");
  }

  const seenParts = new Set<number>();
  const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

  for (const part of sortedParts) {
    if (part.partNumber < 1 || part.partNumber > 10000) {
      throw new Error(`Invalid part number in completion list: ${part.partNumber}`);
    }
    if (!part.etag || part.etag.trim() === "") {
      throw new Error(`Missing ETag for part number: ${part.partNumber}`);
    }
    if (seenParts.has(part.partNumber)) {
      throw new Error(`Duplicate part number in completion list: ${part.partNumber}`);
    }
    seenParts.add(part.partNumber);
  }

  const command = new CompleteMultipartUploadCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: sortedParts.map(p => ({
        ETag: p.etag,
        PartNumber: p.partNumber,
      })),
    }
  });

  await s3.send(command);
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  const command = new AbortMultipartUploadCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
  });

  await s3.send(command);
}

export async function listMultipartParts(key: string, uploadId: string) {
  const command = new ListPartsCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
  });

  const response = await s3.send(command);
  return response.Parts || [];
}

export async function presignUploadPart(
  key: string, 
  uploadId: string, 
  partNumber: number, 
  expiresInSeconds = 3600
): Promise<string> {
  if (partNumber < 1 || partNumber > 10000) {
    throw new Error(`Invalid part number: ${partNumber}. Must be between 1 and 10000.`);
  }

  const command = new UploadPartCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  return getSignedUrl(s3Presigner, command, { expiresIn: expiresInSeconds });
}
