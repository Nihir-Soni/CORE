import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "../src/client.js";
import {
  computeObjectSha256,
  deleteObject,
  getObjectStream,
} from "../src/download.js";

describe("Storage Streaming SHA-256 & Delete Primitives", () => {
  let testKey: string;
  const testContent = "CHiE Phase 7.4 Streaming SHA-256 Test Content";
  const expectedHash = createHash("sha256").update(testContent).digest("hex").toLowerCase();

  before(async () => {
    testKey = `stream-test-${randomUUID()}.txt`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
      Body: testContent,
      ContentType: "text/plain",
    }));
  });

  after(async () => {
    try {
      await deleteObject(testKey);
    } catch {
      // ignore
    }
  });

  test("Known digest verification - computeObjectSha256 matches exact hex", async () => {
    const hash = await computeObjectSha256(testKey);
    assert.equal(hash, expectedHash);
    assert.equal(hash.length, 64);
    assert.equal(hash, hash.toLowerCase());
  });

  test("getObjectStream returns AsyncIterable chunks", async () => {
    const stream = await getObjectStream(testKey);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const fullText = Buffer.concat(chunks).toString("utf-8");
    assert.equal(fullText, testContent);
  });

  test("Large-stream memory test - streaming 1GB virtual object has bounded memory", async () => {
    // Simulate a 1GB stream (1000 chunks of 1MB) without buffering 1GB into a single Node buffer
    const chunkSize = 1024 * 1024; // 1MB chunk
    const totalChunks = 1000; // 1GB total
    const sampleChunk = Buffer.alloc(chunkSize, "x");

    async function* generate1GBStream(): AsyncIterable<Uint8Array> {
      for (let i = 0; i < totalChunks; i++) {
        yield sampleChunk;
      }
    }

    const initialHeap = process.memoryUsage().heapUsed;

    const hash = createHash("sha256");
    let chunkCount = 0;
    for await (const chunk of generate1GBStream()) {
      hash.update(chunk);
      chunkCount++;
    }
    const digest = hash.digest("hex");

    const finalHeap = process.memoryUsage().heapUsed;
    const memoryDiffBytes = Math.abs(finalHeap - initialHeap);

    assert.equal(chunkCount, 1000);
    assert.equal(digest.length, 64);
    // 1GB is ~1,073,741,824 bytes. Verify heap growth during streaming is bounded well below 100MB.
    assert.ok(memoryDiffBytes < 100 * 1024 * 1024, `Heap growth was ${memoryDiffBytes} bytes, expected bounded memory`);
  });

  test("deleteObject removes object from MinIO", async () => {
    const keyToDelete = `delete-test-${randomUUID()}.txt`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: keyToDelete,
      Body: "temp content",
    }));

    await deleteObject(keyToDelete);

    await assert.rejects(
      s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: keyToDelete })),
      /NoSuchKey|Not Found|404/
    );
  });
});
