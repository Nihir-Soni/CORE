/**
 * Unit tests for multipart-upload.ts orchestration module.
 *
 * All external dependencies (api.ts functions and fetch) are mocked.
 * No real network or MinIO calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runMultipartUpload,
  cancelUpload,
  MULTIPART_THRESHOLD_BYTES,
  type MultipartUploadState,
} from "../multipart-upload";
import * as api from "../api";

// ── API mocks ──────────────────────────────────────────────────────────────────
vi.mock("../api", () => ({
  initiateMultipart: vi.fn(),
  getMultipartSession: vi.fn(),
  getPartUrl: vi.fn(),
  completeMultipart: vi.fn(),
  abortMultipart: vi.fn(),
}));

const mockInitiateMultipart = vi.mocked(api.initiateMultipart);
const mockGetMultipartSession = vi.mocked(api.getMultipartSession);
const mockGetPartUrl = vi.mocked(api.getPartUrl);
const mockCompleteMultipart = vi.mocked(api.completeMultipart);
const mockAbortMultipart = vi.mocked(api.abortMultipart);

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFakeFile(sizeBytes: number, name = "test.pdf"): File {
  // Create a Blob of the requested size, wrapped in a File
  const data = new Uint8Array(sizeBytes);
  return new File([data], name, { type: "application/pdf" });
}

/** Build a fetch mock that returns an ETag header. */
function mockFetchSuccess(etag = "test-etag"): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name === "ETag" ? `"${etag}"` : null),
    },
  } as unknown as Response);
}

/** Build a fetch mock that fails N times then succeeds. */
function mockFetchFailsThenSucceeds(failCount: number, etag = "retry-etag"): typeof fetch {
  let calls = 0;
  return vi.fn().mockImplementation(() => {
    calls++;
    if (calls <= failCount) {
      return Promise.reject(new Error(`Network error on attempt ${calls}`));
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name === "ETag" ? `"${etag}"` : null),
      },
    } as unknown as Response);
  });
}

const WORKSPACE_ID = "ws-test";
const SESSION_ID = "sess-test";
const DOCUMENT_ID = "doc-test";

// Standard 2-part session: 16MB file → 8MB parts
const PART_SIZE = 8 * 1024 * 1024; // 8MB
const FILE_SIZE_2_PARTS = 16 * 1024 * 1024; // 16MB

function setupDefaultInitiateMock() {
  mockInitiateMultipart.mockResolvedValue({
    sessionId: SESSION_ID,
    documentId: DOCUMENT_ID,
    uploadId: "upload-id",
    storageKey: "ws/file.pdf",
    partSizeBytes: PART_SIZE,
    totalParts: 2,
  });
}

function setupDefaultPartUrlMock() {
  mockGetPartUrl.mockImplementation(async (_ws, _sess, partNumber) => ({
    partNumber,
    uploadUrl: `https://minio.local/presigned/part-${partNumber}`,
  }));
}

function setupDefaultCompleteMock() {
  mockCompleteMultipart.mockResolvedValue({
    sessionId: SESSION_ID,
    documentId: DOCUMENT_ID,
    status: "COMPLETED",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetchSuccess("etag-default"));
});

// ── Test A — Threshold ─────────────────────────────────────────────────────────

describe("Test A — Threshold routing", () => {
  it("MULTIPART_THRESHOLD_BYTES is 100MB", () => {
    expect(MULTIPART_THRESHOLD_BYTES).toBe(100 * 1024 * 1024);
  });

  it("file below threshold should not call initiateMultipart (caller handles routing)", () => {
    // This test documents the contract: routing is done at the call site.
    // runMultipartUpload() always does multipart — callers check threshold.
    expect(MULTIPART_THRESHOLD_BYTES).toBeGreaterThan(0);
  });
});

// ── Test B — Part slice boundaries ────────────────────────────────────────────

describe("Test B — Part slice boundaries", () => {
  it("correctly slices parts with proper byte boundaries", async () => {
    setupDefaultInitiateMock();
    setupDefaultCompleteMock();

    const slicedRanges: Array<[number, number]> = [];
    const file = makeFakeFile(FILE_SIZE_2_PARTS);

    const originalSlice = file.slice.bind(file);
    vi.spyOn(file, "slice").mockImplementation((start, end) => {
      slicedRanges.push([start as number, end as number]);
      return originalSlice(start, end);
    });

    mockGetPartUrl.mockImplementation(async (_ws, _sess, pn) => ({
      partNumber: pn,
      uploadUrl: `https://minio.local/part-${pn}`,
    }));

    await runMultipartUpload({ workspaceId: WORKSPACE_ID, file });

    expect(slicedRanges).toHaveLength(2);
    // Part 1: bytes 0 – 8MB
    expect(slicedRanges[0]).toEqual([0, PART_SIZE]);
    // Part 2: bytes 8MB – 16MB
    expect(slicedRanges[1]).toEqual([PART_SIZE, FILE_SIZE_2_PARTS]);
  });

  it("final part handles uneven file sizes correctly", async () => {
    const ODD_SIZE = PART_SIZE + 1024; // 8MB + 1KB
    mockInitiateMultipart.mockResolvedValue({
      sessionId: SESSION_ID,
      documentId: DOCUMENT_ID,
      uploadId: "uid",
      storageKey: "key",
      partSizeBytes: PART_SIZE,
      totalParts: 2,
    });
    setupDefaultCompleteMock();

    const slicedRanges: Array<[number, number]> = [];
    const file = makeFakeFile(ODD_SIZE);
    const originalSlice = file.slice.bind(file);
    vi.spyOn(file, "slice").mockImplementation((start, end) => {
      slicedRanges.push([start as number, end as number]);
      return originalSlice(start, end);
    });

    mockGetPartUrl.mockImplementation(async (_ws, _sess, pn) => ({
      partNumber: pn,
      uploadUrl: `https://minio.local/part-${pn}`,
    }));

    await runMultipartUpload({ workspaceId: WORKSPACE_ID, file });

    // Second slice should end at file.size, not at start + partSize
    expect(slicedRanges[1]).toEqual([PART_SIZE, ODD_SIZE]);
  });
});

// ── Test C — Correct partNumber sent ─────────────────────────────────────────

describe("Test C — Presign request uses correct partNumber", () => {
  it("calls getPartUrl with sequential part numbers", async () => {
    setupDefaultInitiateMock();
    setupDefaultPartUrlMock();
    setupDefaultCompleteMock();

    const file = makeFakeFile(FILE_SIZE_2_PARTS);
    await runMultipartUpload({ workspaceId: WORKSPACE_ID, file });

    expect(mockGetPartUrl).toHaveBeenCalledTimes(2);
    expect(mockGetPartUrl).toHaveBeenNthCalledWith(1, WORKSPACE_ID, SESSION_ID, 1);
    expect(mockGetPartUrl).toHaveBeenNthCalledWith(2, WORKSPACE_ID, SESSION_ID, 2);
  });
});

// ── Test D — ETag captured ────────────────────────────────────────────────────

describe("Test D — ETag captured from PUT response header", () => {
  it("captures ETags and submits them in completion call", async () => {
    setupDefaultInitiateMock();
    setupDefaultPartUrlMock();
    setupDefaultCompleteMock();

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: (h: string) => h === "ETag" ? '"etag-part-1"' : null },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: (h: string) => h === "ETag" ? '"etag-part-2"' : null },
      })
    );

    const file = makeFakeFile(FILE_SIZE_2_PARTS);
    const state = await runMultipartUpload({ workspaceId: WORKSPACE_ID, file });

    expect(state.status).toBe("completed");

    // Verify completeMultipart received the correct ETags (quotes stripped)
    expect(mockCompleteMultipart).toHaveBeenCalledWith(WORKSPACE_ID, SESSION_ID, [
      { partNumber: 1, etag: "etag-part-1" },
      { partNumber: 2, etag: "etag-part-2" },
    ]);
  });
});

// ── Test E — Retry on transient failure ───────────────────────────────────────

describe("Test E — Part retry on transient failure", () => {
  it("retries a failed part and succeeds on second attempt", async () => {
    setupDefaultInitiateMock();
    setupDefaultPartUrlMock();
    setupDefaultCompleteMock();

    vi.stubGlobal("fetch", mockFetchFailsThenSucceeds(1, "etag-retry"));

    const file = makeFakeFile(PART_SIZE); // 1-part upload for simplicity
    mockInitiateMultipart.mockResolvedValue({
      sessionId: SESSION_ID,
      documentId: DOCUMENT_ID,
      uploadId: "uid",
      storageKey: "key",
      partSizeBytes: PART_SIZE,
      totalParts: 1,
    });

    const state = await runMultipartUpload({ workspaceId: WORKSPACE_ID, file });

    expect(state.status).toBe("completed");
    // fetch was called twice (1 fail + 1 success)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("fails after max retries without aborting the server session", async () => {
    setupDefaultInitiateMock();
    setupDefaultPartUrlMock();

    // Always fail (more than MAX_PART_RETRIES)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("persistent network error")));

    const file = makeFakeFile(PART_SIZE);
    mockInitiateMultipart.mockResolvedValue({
      sessionId: SESSION_ID,
      documentId: DOCUMENT_ID,
      uploadId: "uid",
      storageKey: "key",
      partSizeBytes: PART_SIZE,
      totalParts: 1,
    });

    const state = await runMultipartUpload({ workspaceId: WORKSPACE_ID, file });

    // Status is failed, not aborted
    expect(state.status).toBe("failed");
    expect(state.error).toContain("persistent network error");

    // Server session was NOT aborted — it remains resumable
    expect(mockAbortMultipart).not.toHaveBeenCalled();
  });
});

// ── Test F — Interruption does not abort server session ───────────────────────

describe("Test F — Interruption preserves server session for resume", () => {
  it("network failure leaves status=failed without calling abort", async () => {
    setupDefaultInitiateMock();
    setupDefaultPartUrlMock();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network gone")));

    const file = makeFakeFile(FILE_SIZE_2_PARTS);
    const state = await runMultipartUpload({ workspaceId: WORKSPACE_ID, file });

    expect(state.status).toBe("failed");
    expect(mockAbortMultipart).not.toHaveBeenCalled();

    // sessionId and documentId are preserved for resume
    expect(state.sessionId).toBe(SESSION_ID);
    expect(state.documentId).toBe(DOCUMENT_ID);
  });
});

// ── Test G — Resume skips already-uploaded parts ──────────────────────────────

describe("Test G — Resume skips already-uploaded parts", () => {
  it("skips parts already reported by MinIO ListParts", async () => {
    // Session exists with part 1 already uploaded
    mockGetMultipartSession.mockResolvedValue({
      sessionId: SESSION_ID,
      documentId: DOCUMENT_ID,
      status: "INITIATED",
      partSizeBytes: PART_SIZE,
      totalParts: 2,
      uploadedParts: [{ partNumber: 1, etag: "existing-etag-1" }],
    });
    setupDefaultPartUrlMock();
    setupDefaultCompleteMock();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: (h: string) => h === "ETag" ? '"etag-2"' : null },
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = makeFakeFile(FILE_SIZE_2_PARTS);
    const state = await runMultipartUpload({
      workspaceId: WORKSPACE_ID,
      file,
      sessionId: SESSION_ID, // resume
    });

    expect(state.status).toBe("completed");

    // Only 1 fetch call — part 1 was skipped, only part 2 uploaded
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockGetPartUrl).toHaveBeenCalledWith(WORKSPACE_ID, SESSION_ID, 2);
    expect(mockGetPartUrl).not.toHaveBeenCalledWith(WORKSPACE_ID, SESSION_ID, 1);

    // Completion includes BOTH parts (from resume state + newly uploaded)
    expect(mockCompleteMultipart).toHaveBeenCalledWith(WORKSPACE_ID, SESSION_ID, [
      { partNumber: 1, etag: "existing-etag-1" },
      { partNumber: 2, etag: "etag-2" },
    ]);

    // No new session was initiated
    expect(mockInitiateMultipart).not.toHaveBeenCalled();
  });
});

// ── Test H — All ETags submitted on completion ────────────────────────────────

describe("Test H — Completion submits all ETags", () => {
  it("completeMultipart receives all parts in order", async () => {
    const THREE_PART_SIZE = PART_SIZE * 3;
    mockInitiateMultipart.mockResolvedValue({
      sessionId: SESSION_ID,
      documentId: DOCUMENT_ID,
      uploadId: "uid",
      storageKey: "key",
      partSizeBytes: PART_SIZE,
      totalParts: 3,
    });
    mockGetPartUrl.mockImplementation(async (_ws, _sess, pn) => ({
      partNumber: pn,
      uploadUrl: `https://minio.local/part-${pn}`,
    }));
    setupDefaultCompleteMock();

    let partCounter = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      partCounter++;
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: (h: string) => h === "ETag" ? `"etag-${partCounter}"` : null },
      });
    }));

    const file = makeFakeFile(THREE_PART_SIZE);
    await runMultipartUpload({ workspaceId: WORKSPACE_ID, file });

    expect(mockCompleteMultipart).toHaveBeenCalledWith(
      WORKSPACE_ID,
      SESSION_ID,
      [
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2" },
        { partNumber: 3, etag: "etag-3" },
      ]
    );
  });
});

// ── Test I — Cancellation calls server abort ──────────────────────────────────

describe("Test I — Cancellation", () => {
  it("cancelUpload aborts the session and stops uploads", async () => {
    mockInitiateMultipart.mockResolvedValue({
      sessionId: SESSION_ID,
      documentId: DOCUMENT_ID,
      uploadId: "uid",
      storageKey: "key",
      partSizeBytes: PART_SIZE,
      totalParts: 3,
    });
    mockGetPartUrl.mockImplementation(async (_ws, _sess, pn) => ({
      partNumber: pn,
      uploadUrl: `https://minio.local/part-${pn}`,
    }));
    mockAbortMultipart.mockResolvedValue({ status: "ABORTED" });

    let partUploadCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      partUploadCount++;
      if (partUploadCount === 1) {
        // Cancel mid-upload after first part succeeds
        cancelUpload(SESSION_ID);
      }
      return {
        ok: true, status: 200,
        headers: { get: (h: string) => h === "ETag" ? '"etag-x"' : null },
      };
    }));

    const file = makeFakeFile(PART_SIZE * 3);
    const states: MultipartUploadState[] = [];

    const finalState = await runMultipartUpload({
      workspaceId: WORKSPACE_ID,
      file,
      onProgress: (s) => states.push({ ...s, uploadedParts: new Map(s.uploadedParts) }),
    });

    expect(finalState.status).toBe("aborted");
    expect(mockAbortMultipart).toHaveBeenCalledWith(WORKSPACE_ID, SESSION_ID);
    // Not all 3 parts were uploaded
    expect(partUploadCount).toBeLessThan(3);
  });
});

// ── Test J — Error state ──────────────────────────────────────────────────────

describe("Test J — Permanent failure produces useful error state", () => {
  it("initiate failure produces failed status with error message", async () => {
    mockInitiateMultipart.mockRejectedValue(new Error("Server rejected initiate: 400"));

    const file = makeFakeFile(FILE_SIZE_2_PARTS);

    await expect(
      runMultipartUpload({ workspaceId: WORKSPACE_ID, file })
    ).rejects.toThrow("Server rejected initiate: 400");
  });

  it("completion failure produces failed status", async () => {
    setupDefaultInitiateMock();
    setupDefaultPartUrlMock();
    mockCompleteMultipart.mockRejectedValue(new Error("etag_mismatch"));

    vi.stubGlobal("fetch", mockFetchSuccess("some-etag"));

    const file = makeFakeFile(FILE_SIZE_2_PARTS);
    const state = await runMultipartUpload({ workspaceId: WORKSPACE_ID, file });

    expect(state.status).toBe("failed");
    expect(state.error).toContain("Completion failed");
    expect(state.error).toContain("etag_mismatch");
  });
});

// ── Progress reporting ────────────────────────────────────────────────────────

describe("Progress reporting", () => {
  it("onProgress is called with increasing completedParts", async () => {
    setupDefaultInitiateMock();
    setupDefaultPartUrlMock();
    setupDefaultCompleteMock();
    vi.stubGlobal("fetch", mockFetchSuccess("etag-p"));

    const snapshots: Array<{ status: string; completedParts: number }> = [];

    const file = makeFakeFile(FILE_SIZE_2_PARTS);
    await runMultipartUpload({
      workspaceId: WORKSPACE_ID,
      file,
      onProgress: (s) => snapshots.push({ status: s.status, completedParts: s.completedParts }),
    });

    // Should progress: initiating → uploading (0) → uploading (1) → uploading (2) → completing → completed
    const statuses = snapshots.map((s) => s.status);
    expect(statuses).toContain("initiating");
    expect(statuses).toContain("uploading");
    expect(statuses).toContain("completing");
    expect(statuses).toContain("completed");

    // completedParts increases monotonically
    const parts = snapshots.map((s) => s.completedParts);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i]).toBeGreaterThanOrEqual(parts[i - 1]);
    }
  });
});
