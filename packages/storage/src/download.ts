import { createHash } from "node:crypto";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "./client.js";

/**
 * Downloads an object from MinIO and returns it as a Buffer.
 * 
 * @param storageKey The exact object key to download.
 * @returns A Buffer containing the object data.
 */
export async function downloadObjectBuffer(storageKey: string): Promise<Buffer> {
    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
    });

    const response = await s3.send(command);

    if (!response.Body) {
        throw new Error(`Failed to download object: ${storageKey} - body is empty`);
    }

    // Convert the readable stream to a Buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

/**
 * Obtains an object's readable byte stream from MinIO/S3.
 * 
 * @param storageKey The exact object key to stream.
 * @returns An AsyncIterable stream of Uint8Array chunks.
 */
export async function getObjectStream(storageKey: string): Promise<AsyncIterable<Uint8Array>> {
    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
    });

    const response = await s3.send(command);

    if (!response.Body) {
        throw new Error(`Failed to stream object: ${storageKey} - body is empty`);
    }

    return response.Body as unknown as AsyncIterable<Uint8Array>;
}

/**
 * Computes the SHA-256 digest of a stored object incrementally using a stream.
 * Never loads the entire object into a single Node Buffer.
 * 
 * @param storageKey The exact object key to hash.
 * @returns 64-character lowercase hexadecimal digest string.
 */
export async function computeObjectSha256(storageKey: string): Promise<string> {
    const hash = createHash("sha256");
    const stream = await getObjectStream(storageKey);

    for await (const chunk of stream) {
        hash.update(chunk);
    }

    return hash.digest("hex").toLowerCase();
}

/**
 * Deletes an object from MinIO/S3.
 * 
 * @param storageKey The exact object key to delete.
 */
export async function deleteObject(storageKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
    });

    await s3.send(command);
}

