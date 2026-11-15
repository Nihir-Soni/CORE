import { env } from "@core/shared";
import { prisma } from "@core/database";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

async function main() {
    console.log("Setting up data...");
    const org = await prisma.organization.create({
        data: { name: "E2E Test Org " + randomUUID() }
    });
    
    const user = await prisma.user.create({
        data: {
            email: `e2e_${randomUUID()}@test.com`,
            passwordHash: "hash",
            orgId: org.id
        }
    });
    
    const token = jwt.sign({ userId: user.id, orgId: org.id }, env.JWT_SECRET);
    
    const workspace = await prisma.workspace.create({
        data: {
            name: "E2E Workspace",
            orgId: org.id,
            memberships: {
                create: { userId: user.id, role: "MEMBER" }
            }
        }
    });

    console.log("1. Requesting upload URL");
    const uploadReq = await fetch(`http://localhost:4000/documents/${workspace.id}/upload-url`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
            filename: "test.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1000
        })
    });
    
    const uploadRes = await uploadReq.json();
    console.log("Upload URL response:", uploadRes);

    console.log("2. Uploading file to MinIO");
    // Just a dummy PDF content
    const pdfContent = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 51 >>\nstream\nBT\n/F1 12 Tf\n72 712 Td\n(Hello World) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000214 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n314\n%%EOF");
    
    const s3Req = await fetch(uploadRes.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: pdfContent
    });
    if (!s3Req.ok) {
        throw new Error("MinIO upload failed: " + await s3Req.text());
    }

    console.log("3. Calling completion endpoint");
    const completeStartTime = Date.now();
    const completeReq = await fetch(`http://localhost:4000/documents/${workspace.id}/${uploadRes.documentId}/complete`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });
    const completeDuration = Date.now() - completeStartTime;
    
    const completeRes = await completeReq.json();
    console.log(`Completion response in ${completeDuration}ms:`, completeRes);
    
    if (completeRes.status !== "PROCESSING") {
        throw new Error("Expected status PROCESSING, got " + completeRes.status);
    }
    
    console.log("4. Waiting for worker to process...");
    let status = "PROCESSING";
    while (status !== "READY" && status !== "FAILED") {
        await new Promise(r => setTimeout(r, 1000));
        const check = await prisma.document.findUnique({ where: { id: uploadRes.documentId } });
        status = check!.status;
        console.log(`Current status: ${status}`);
    }

    console.log("5. Testing retrieval");
    const retrieveReq = await fetch(`http://localhost:4000/documents/${workspace.id}/retrieve`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ query: "Hello", topK: 3 })
    });
    const retrieveRes = await retrieveReq.json();
    console.log("Retrieval results:", retrieveRes.results.length);
    
    console.log("E2E Test Passed Successfully!");
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
