import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  initiateMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  presignUploadPart,
} from "../src/multipart.js";
import { s3, BUCKET } from "../src/client.js";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

describe("Multipart Upload Primitives", () => {
  let uploadId: string;
  let testKey: string;

  before(async () => {
    testKey = `multipart-test-${randomUUID()}.txt`;
  });

  after(async () => {
    // Cleanup if object was actually created
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: testKey }));
    } catch (e) {
      // ignore
    }
  });

  test("Test A - initiate returns uploadId", async () => {
    const res = await initiateMultipartUpload(testKey, "text/plain");
    assert.ok(res.uploadId);
    assert.equal(typeof res.uploadId, "string");
    uploadId = res.uploadId;
  });

  test("Test B - upload part returns ETag", async () => {
    // MinIO allows smaller parts if it's the only part, or for tests we can just upload small parts 
    // Wait, completeMultipartUpload fails if non-last parts are < 5MB in AWS S3, but we aren't completing this test!
    const res = await uploadPart(testKey, uploadId, 1, Buffer.from("part 1 data"));
    assert.ok(res.etag);
    assert.equal(typeof res.etag, "string");
  });

  test("Test E - presigned part URL", async () => {
    const url = await presignUploadPart(testKey, uploadId, 2);
    assert.ok(url);
    assert.ok(url.includes("partNumber=2"));
    assert.ok(url.includes(uploadId));
  });

  test("Test F - malformed completion (empty list)", async () => {
    await assert.rejects(
      completeMultipartUpload(testKey, uploadId, []),
      /Cannot complete multipart upload with empty parts list/
    );
  });

  test("Test F - malformed completion (missing ETag)", async () => {
    await assert.rejects(
      completeMultipartUpload(testKey, uploadId, [{ partNumber: 1, etag: "" }]),
      /Missing ETag for part number: 1/
    );
  });

  test("Test F - malformed completion (duplicate part numbers)", async () => {
    await assert.rejects(
      completeMultipartUpload(testKey, uploadId, [
        { partNumber: 1, etag: "a" },
        { partNumber: 1, etag: "b" },
      ]),
      /Duplicate part number in completion list: 1/
    );
  });

  test("Test D - abort", async () => {
    await abortMultipartUpload(testKey, uploadId);
    
    // Uploading a part after abort should fail
    await assert.rejects(
      uploadPart(testKey, uploadId, 3, Buffer.from("data")),
      /NoSuchUpload|Not Found/ // AWS S3 responds with NoSuchUpload, MinIO sometimes says Not Found
    );
  });
});

describe("Multipart Integration Tests (Real MinIO)", () => {
  const downloadAndRead = async (key: string): Promise<string> => {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const res = await s3.send(cmd);
    const body = await res.Body?.transformToString();
    return body || "";
  };

  test("Real MinIO multipart test - Out-of-order & Interrupted-part test", async () => {
    const key = `integration-test-${randomUUID()}.txt`;
    const res = await initiateMultipartUpload(key, "text/plain");
    const uploadId = res.uploadId;

    // Simulate Interrupted-part test & Out-of-order upload test:
    // We will upload part 3, 1, and 4 successfully, but part 2 fails. Then we retry part 2.
    // Order of operations:
    // 1. Upload part 3
    // 2. Upload part 1
    // 3. Upload part 4
    // 4. Retry part 2
    
    // In minio, parts minimum size is 5MB for everything except the last part.
    // So we need buffers of at least 5MB.
    const partSize = 5 * 1024 * 1024;
    const part1Buf = Buffer.alloc(partSize, "1");
    const part2Buf = Buffer.alloc(partSize, "2");
    const part3Buf = Buffer.alloc(partSize, "3");
    const part4Buf = Buffer.from("end");

    const p3 = await uploadPart(key, uploadId, 3, part3Buf);
    const p1 = await uploadPart(key, uploadId, 1, part1Buf);
    const p4 = await uploadPart(key, uploadId, 4, part4Buf);

    // Simulate failure by not uploading part 2 initially...
    // Then we retry part 2:
    const p2 = await uploadPart(key, uploadId, 2, part2Buf);

    // Complete in arbitrary order, `completeMultipartUpload` must sort it
    const parts = [
      { partNumber: 3, etag: p3.etag },
      { partNumber: 1, etag: p1.etag },
      { partNumber: 4, etag: p4.etag },
      { partNumber: 2, etag: p2.etag },
    ];

    await completeMultipartUpload(key, uploadId, parts);

    // Verify
    const finalObject = await downloadAndRead(key);
    assert.equal(finalObject.length, (partSize * 3) + 3);
    
    // Check first character, middle character, end character
    assert.equal(finalObject[0], "1");
    assert.equal(finalObject[partSize], "2");
    assert.equal(finalObject[partSize * 2], "3");
    assert.equal(finalObject.substring(partSize * 3), "end");

    // Cleanup
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  });
});
