import { randomUUID } from "node:crypto";
import { prisma } from "../../packages/database/src/index.js";
import { env } from "../../packages/shared/src/index.js";
import { createServer } from "node:http";
import request from "supertest";
import { app } from "./src/index.js";
import { setAIProvider } from "./src/routes/document.js";
import type { AIProvider } from "../../packages/ai/src/index.js";
import jwt from "jsonwebtoken";

class MockAIProvider implements AIProvider {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(768).fill(0.01);
    vec[0] = text.length; // Fake variance
    const sqSum = vec.reduce((sum, v) => sum + v * v, 0);
    const mag = Math.sqrt(sqSum);
    return vec.map(v => v / mag);
  }
  async chat() { return "mock"; }
}

async function runE2E() {
  console.log("Starting Phase 4 E2E Journey (Mock Provider)");
  
  // Set provider
  setAIProvider(new MockAIProvider());
  
  // 1. Authenticated member
  console.log("1. Creating User and Workspace...");
  const org = await prisma.organization.create({ data: { name: "E2E Org " + randomUUID() } });
  const user = await prisma.user.create({ data: { email: `e2e_${randomUUID()}@test.com`, passwordHash: "x", orgId: org.id } });
  const ws = await prisma.workspace.create({
    data: { name: "E2E WS", orgId: org.id, memberships: { create: { userId: user.id, role: "MEMBER" } } }
  });
  const token = jwt.sign({ userId: user.id, orgId: org.id }, env.JWT_SECRET);
  
  // 2. Upload Document
  console.log("2. Uploading Document...");
  const uploadRes = await request(app)
    .post(`/documents/${ws.id}/upload-url`)
    .set("Authorization", `Bearer ${token}`)
    .send({ filename: "test.pdf", mimeType: "application/pdf", sizeBytes: 1024 });
  
  if (uploadRes.status !== 201) throw new Error("Upload failed: " + uploadRes.text);
  const docId = uploadRes.body.documentId;
  
  // Fake S3 presigned upload
  await prisma.document.update({ where: { id: docId }, data: { status: "UPLOADED" } });

  // 3. Complete Upload (handled natively above, or simulate extraction by creating DocumentContent)
  // Instead of actually putting it in S3, we will bypass extract route and fake the content because extract requires minio storage.
  console.log("3. Faking Extraction (Bypassing Minio)...");
  await prisma.documentContent.create({
    data: {
      documentId: docId,
      text: "This is a deterministic document representing a manual upload. It has multiple words.",
      pageCount: 1,
      charCount: 100
    }
  });

  // 4. Index Document
  console.log("4. Indexing Document...");
  const indexRes = await request(app)
    .post(`/documents/${ws.id}/${docId}/index`)
    .set("Authorization", `Bearer ${token}`);
  
  if (indexRes.status !== 200) throw new Error("Index failed: " + indexRes.text);
  console.log(`Indexed! Chunks: ${indexRes.body.chunkCount}, Embeddings: ${indexRes.body.embeddingCount}`);

  // 5. Verify READY
  const docCheck = await prisma.document.findUnique({ where: { id: docId } });
  if (docCheck?.status !== "READY") throw new Error("Document is not READY");

  // 6. Retrieve Using Natural Language
  console.log("5. Retrieving Chunks...");
  const searchRes = await request(app)
    .post(`/documents/${ws.id}/retrieve`)
    .set("Authorization", `Bearer ${token}`)
    .send({ query: "deterministic", topK: 5 });

  if (searchRes.status !== 200) throw new Error("Retrieve failed: " + searchRes.text);
  
  console.log(`Found ${searchRes.body.results.length} results.`);
  if (searchRes.body.results.length === 0) throw new Error("No results returned!");
  
  const top = searchRes.body.results[0];
  console.log(`Top result: [${top.similarity}] ${top.content}`);

  console.log("E2E JOURNEY SUCCESSFUL.");
  process.exit(0);
}

runE2E().catch(err => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
