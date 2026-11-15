import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTesseractPath,
  verifyTesseract,
  runTesseractFile,
  OcrConcurrencyLimiter,
  OcrMissingBinaryError,
  OcrTimeoutError,
  OcrExecutionError,
  CommandExecutor,
  getInstallationInstructions,
} from "../src/ocr/tesseract.js";

describe("Tesseract OCR Engine - Unit Tests", () => {
  describe("Binary resolution", () => {
    it("returns customPath when explicitly specified", () => {
      const custom = "D:\\custom\\tesseract.exe";
      const resolved = resolveTesseractPath(custom);
      assert.equal(resolved, custom);
    });

    it("respects TESSERACT_PATH environment variable", () => {
      const original = process.env.TESSERACT_PATH;
      try {
        process.env.TESSERACT_PATH = "/usr/local/bin/tesseract";
        const resolved = resolveTesseractPath();
        assert.equal(resolved, "/usr/local/bin/tesseract");
      } finally {
        if (original === undefined) {
          delete process.env.TESSERACT_PATH;
        } else {
          process.env.TESSERACT_PATH = original;
        }
      }
    });

    it("falls back to standard platform binary if no custom path or env set", () => {
      const original = process.env.TESSERACT_PATH;
      try {
        delete process.env.TESSERACT_PATH;
        const resolved = resolveTesseractPath();
        assert.ok(typeof resolved === "string" && resolved.length > 0);
      } finally {
        if (original !== undefined) {
          process.env.TESSERACT_PATH = original;
        }
      }
    });
  });

  describe("Verification and Diagnostics", () => {
    it("reports available with version and languages when executable succeeds", async () => {
      const mockExecutor: CommandExecutor = async (_file, args) => {
        if (args.includes("--version")) {
          return {
            stdout: "tesseract 5.4.0\n leptonica-1.84.1\n  libgif 5.2.2 : libjpeg 8d : libpng 1.6.43 : libtiff 4.6.0\n",
            stderr: "",
          };
        }
        if (args.includes("--list-langs")) {
          return {
            stdout: "List of available languages in /usr/share/tessdata:\neng\nosd\n",
            stderr: "",
          };
        }
        throw new Error(`Unexpected args: ${args.join(" ")}`);
      };

      const result = await verifyTesseract({
        binaryPath: "tesseract",
        requiredLanguage: "eng",
        executor: mockExecutor,
      });

      assert.equal(result.available, true);
      assert.equal(result.version, "5.4.0");
      assert.equal(result.hasRequiredLanguage, true);
      assert.deepEqual(result.languages, ["eng", "osd"]);
      assert.equal(result.error, undefined);
    });

    it("returns actionable instructions when binary is not found (ENOENT)", async () => {
      const mockExecutor: CommandExecutor = async () => {
        const err: any = new Error("spawn tesseract ENOENT");
        err.code = "ENOENT";
        throw err;
      };

      const result = await verifyTesseract({
        binaryPath: "nonexistent-tesseract",
        executor: mockExecutor,
      });

      assert.equal(result.available, false);
      assert.equal(result.version, null);
      assert.equal(result.hasRequiredLanguage, false);
      assert.ok(result.error?.includes("not found"));
      assert.ok(result.instructions?.includes("Install Tesseract"));
    });

    it("detects when required language data is missing", async () => {
      const mockExecutor: CommandExecutor = async (_file, args) => {
        if (args.includes("--version")) {
          return { stdout: "tesseract 5.3.0\n", stderr: "" };
        }
        if (args.includes("--list-langs")) {
          return { stdout: "fra\ndeu\n", stderr: "" };
        }
        throw new Error("Unexpected");
      };

      const result = await verifyTesseract({
        binaryPath: "tesseract",
        requiredLanguage: "eng",
        executor: mockExecutor,
      });

      assert.equal(result.available, true);
      assert.equal(result.hasRequiredLanguage, false);
      assert.deepEqual(result.languages, ["fra", "deu"]);
      assert.ok(result.error?.includes("Required language 'eng' is missing"));
      assert.ok(result.instructions?.includes("eng"));
    });
  });

  describe("Safe Child Process Execution", () => {
    it("executes tesseract using argument arrays and returns stdout", async () => {
      let recordedFile = "";
      let recordedArgs: string[] = [];

      const mockExecutor: CommandExecutor = async (file, args) => {
        recordedFile = file;
        recordedArgs = args;
        return { stdout: "Extracted document text\n\n", stderr: "" };
      };

      const limiter = new OcrConcurrencyLimiter(1);
      const text = await runTesseractFile(
        "/tmp/test_image.png",
        { binaryPath: "/bin/tesseract", language: "eng", timeoutMs: 5000 },
        limiter,
        mockExecutor
      );

      assert.equal(text, "Extracted document text\n\n");
      assert.equal(recordedFile, "/bin/tesseract");
      assert.deepEqual(recordedArgs, [
        "/tmp/test_image.png",
        "stdout",
        "-l",
        "eng",
        "--oem",
        "1",
        "--psm",
        "3",
      ]);
    });

    it("throws OcrTimeoutError when child process is killed by timeout", async () => {
      const mockExecutor: CommandExecutor = async () => {
        const err: any = new Error("Command failed: tesseract");
        err.killed = true;
        err.signal = "SIGTERM";
        throw err;
      };

      const limiter = new OcrConcurrencyLimiter(1);
      await assert.rejects(
        runTesseractFile(
          "/tmp/huge.png",
          { binaryPath: "tesseract", timeoutMs: 1500 },
          limiter,
          mockExecutor
        ),
        (err: any) => {
          assert.ok(err instanceof OcrTimeoutError);
          assert.equal(err.code, "TIMEOUT");
          assert.ok(err.message.includes("1500ms"));
          return true;
        }
      );
    });

    it("throws OcrMissingBinaryError on ENOENT error", async () => {
      const mockExecutor: CommandExecutor = async () => {
        const err: any = new Error("spawn ENOENT");
        err.code = "ENOENT";
        throw err;
      };

      const limiter = new OcrConcurrencyLimiter(1);
      await assert.rejects(
        runTesseractFile(
          "/tmp/img.png",
          { binaryPath: "missing-binary" },
          limiter,
          mockExecutor
        ),
        (err: any) => {
          assert.ok(err instanceof OcrMissingBinaryError);
          assert.equal(err.code, "MISSING_BINARY");
          return true;
        }
      );
    });

    it("throws OcrExecutionError on general execution failures without leaking secrets", async () => {
      const mockExecutor: CommandExecutor = async () => {
        const err: any = new Error("Leptonica error: format unsupported");
        err.code = 1;
        throw err;
      };

      const limiter = new OcrConcurrencyLimiter(1);
      await assert.rejects(
        runTesseractFile(
          "/tmp/corrupt.png",
          { binaryPath: "tesseract" },
          limiter,
          mockExecutor
        ),
        (err: any) => {
          assert.ok(err instanceof OcrExecutionError);
          assert.equal(err.code, "EXECUTION_FAILED");
          assert.equal(err.exitCode, 1);
          return true;
        }
      );
    });
  });

  describe("Concurrency Limiter", () => {
    it("limits simultaneous tasks to maxConcurrency", async () => {
      const limiter = new OcrConcurrencyLimiter(2);
      let running = 0;
      let maxSeenRunning = 0;

      const task = async () => {
        return limiter.run(async () => {
          running++;
          maxSeenRunning = Math.max(maxSeenRunning, running);
          await new Promise((r) => setTimeout(r, 20));
          running--;
        });
      };

      await Promise.all([task(), task(), task(), task()]);
      assert.equal(maxSeenRunning, 2);
      assert.equal(limiter.getActiveCount(), 0);
    });
  });
});
