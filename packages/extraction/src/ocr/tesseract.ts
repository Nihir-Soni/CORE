import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OcrMode = "auto" | "force" | "off";

export interface TesseractDiagnosticResult {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
  languages: string[];
  hasRequiredLanguage: boolean;
  requiredLanguage: string;
  error?: string;
  instructions?: string;
}

export interface TesseractRunOptions {
  binaryPath?: string;
  language?: string;
  tessdataPrefix?: string;
  timeoutMs?: number;
  psm?: number;
  oem?: number;
  maxBuffer?: number;
}

export class OcrError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "OcrError";
  }
}

export class OcrMissingBinaryError extends OcrError {
  constructor(instructions: string) {
    super(`Tesseract OCR binary not found. ${instructions}`, "MISSING_BINARY");
  }
}

export class OcrMissingLanguageError extends OcrError {
  constructor(language: string, availableLanguages: string[]) {
    super(
      `Tesseract OCR language '${language}' not found in available languages: [${availableLanguages.join(
        ", "
      )}]. Ensure '${language}.traineddata' is installed in TESSDATA_PREFIX.`,
      "MISSING_LANGUAGE"
    );
  }
}

export class OcrTimeoutError extends OcrError {
  constructor(timeoutMs: number) {
    super(`Tesseract OCR process timed out after ${timeoutMs}ms.`, "TIMEOUT");
  }
}

export class OcrExecutionError extends OcrError {
  constructor(message: string, public readonly exitCode?: number | null) {
    super(message, "EXECUTION_FAILED");
  }
}

/**
 * Standard candidate executable paths on Windows systems.
 */
export const STANDARD_WINDOWS_PATHS: string[] = [
  "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
  "C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe",
];

if (process.env.LOCALAPPDATA) {
  STANDARD_WINDOWS_PATHS.push(
    path.join(process.env.LOCALAPPDATA, "Programs", "Tesseract-OCR", "tesseract.exe")
  );
}

/**
 * Resolves the absolute or executable path for Tesseract OCR.
 *
 * Precedence:
 * 1. Explicitly provided override path
 * 2. TESSERACT_PATH environment variable
 * 3. Standard Windows installation locations (if on win32)
 * 4. Default 'tesseract' binary name for PATH lookup
 */
export function resolveTesseractPath(customPath?: string): string {
  if (customPath && customPath.trim().length > 0) {
    return customPath.trim();
  }

  const envPath = process.env.TESSERACT_PATH;
  if (envPath && envPath.trim().length > 0) {
    return envPath.trim();
  }

  if (process.platform === "win32") {
    for (const winPath of STANDARD_WINDOWS_PATHS) {
      try {
        if (fs.existsSync(winPath)) {
          return winPath;
        }
      } catch {
        // Ignore filesystem check errors and proceed
      }
    }
  }

  return process.platform === "win32" ? "tesseract.exe" : "tesseract";
}

/**
 * Generates platform-appropriate installation instructions.
 */
export function getInstallationInstructions(): string {
  if (process.platform === "win32") {
    return (
      "Install Tesseract on Windows using winget: 'winget install --id UB-Mannheim.TesseractOCR' " +
      "or download from https://github.com/UB-Mannheim/tesseract/wiki and verify 'tesseract.exe' is added to PATH " +
      "or configure TESSERACT_PATH."
    );
  }
  return (
    "Install Tesseract on Linux: 'sudo apt-get install -y tesseract-ocr tesseract-ocr-eng' " +
    "(or distribution equivalent) and ensure 'tesseract' is in PATH or configure TESSERACT_PATH."
  );
}

export type CommandExecutor = (
  file: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Default child-process executor using execFile (safe array invocation, NO shell).
 */
export const defaultExecutor: CommandExecutor = async (file, args, options) => {
  return execFileAsync(file, args, {
    timeout: options?.timeout,
    maxBuffer: options?.maxBuffer,
    env: options?.env ?? process.env,
    windowsHide: true,
  });
};

/**
 * Verifies that the Tesseract executable and requested language data are available.
 */
export async function verifyTesseract(options?: {
  binaryPath?: string;
  requiredLanguage?: string;
  executor?: CommandExecutor;
}): Promise<TesseractDiagnosticResult> {
  const binary = resolveTesseractPath(options?.binaryPath);
  const requiredLanguage = options?.requiredLanguage ?? "eng";
  const executor = options?.executor ?? defaultExecutor;
  const instructions = getInstallationInstructions();

  let version: string | null = null;
  try {
    const versionRes = await executor(binary, ["--version"], { timeout: 10000 });
    const versionMatch = versionRes.stdout.match(/tesseract\s+([0-9a-zA-Z.-]+)/i);
    version = versionMatch ? versionMatch[1] : (versionRes.stdout.split("\n")[0]?.trim() || "unknown");
  } catch (err: any) {
    const isNotFound =
      err?.code === "ENOENT" ||
      (typeof err?.message === "string" &&
        (err.message.includes("ENOENT") ||
          err.message.includes("not recognized") ||
          err.message.includes("cannot find the file")));

    return {
      available: false,
      binaryPath: binary,
      version: null,
      languages: [],
      hasRequiredLanguage: false,
      requiredLanguage,
      error: isNotFound
        ? `Tesseract executable not found at '${binary}'.`
        : `Tesseract version check failed: ${err?.message || String(err)}`,
      instructions,
    };
  }

  let languages: string[] = [];
  try {
    const langsRes = await executor(binary, ["--list-langs"], { timeout: 10000 });
    const combinedOutput = `${langsRes.stdout}\n${langsRes.stderr}`;
    languages = combinedOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("list of"));
  } catch (err: any) {
    return {
      available: true,
      binaryPath: binary,
      version,
      languages: [],
      hasRequiredLanguage: false,
      requiredLanguage,
      error: `Failed to list Tesseract languages: ${err?.message || String(err)}`,
      instructions: "Ensure language data (.traineddata) is installed in TESSDATA_PREFIX or the Tesseract tessdata folder.",
    };
  }

  const hasRequiredLanguage = languages.includes(requiredLanguage);

  return {
    available: true,
    binaryPath: binary,
    version,
    languages,
    hasRequiredLanguage,
    requiredLanguage,
    error: hasRequiredLanguage
      ? undefined
      : `Required language '${requiredLanguage}' is missing from installed languages: [${languages.join(", ")}].`,
    instructions: hasRequiredLanguage
      ? undefined
      : `Install the '${requiredLanguage}' traineddata file (e.g. 'tesseract-ocr-${requiredLanguage}' on Linux or selecting it in the Windows installer).`,
  };
}

/**
 * Concurrency Limiter / Semaphore to bound simultaneous Tesseract process execution.
 */
export class OcrConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(public readonly maxConcurrency: number = 2) {
    if (maxConcurrency < 1) {
      throw new Error("Concurrency must be at least 1");
    }
  }

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  getActiveCount(): number {
    return this.active;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

const defaultLimiter = new OcrConcurrencyLimiter(
  Number(process.env.OCR_CONCURRENCY) > 0 ? Number(process.env.OCR_CONCURRENCY) : 2
);

/**
 * Runs Tesseract OCR on an image file on disk.
 *
 * @param imagePath Absolute path to the source image file.
 * @param options OCR options including timeout, language, binaryPath, psm, oem.
 * @param limiter Optional concurrency limiter.
 * @param executor Optional command executor for test injection.
 * @returns Recognized text trimmed of trailing whitespace.
 */
export async function runTesseractFile(
  imagePath: string,
  options?: TesseractRunOptions,
  limiter: OcrConcurrencyLimiter = defaultLimiter,
  executor: CommandExecutor = defaultExecutor
): Promise<string> {
  const binary = resolveTesseractPath(options?.binaryPath);
  const language = options?.language ?? "eng";
  const timeoutMs = options?.timeoutMs ?? 30000;
  const maxBuffer = options?.maxBuffer ?? 10 * 1024 * 1024; // 10MB
  const psm = options?.psm ?? 3;
  const oem = options?.oem ?? 1;

  const args: string[] = [
    imagePath,
    "stdout",
    "-l",
    language,
    "--oem",
    String(oem),
    "--psm",
    String(psm),
  ];

  if (options?.tessdataPrefix) {
    args.push("--tessdata-dir", options.tessdataPrefix);
  }

  const customEnv: NodeJS.ProcessEnv = { ...process.env };
  if (options?.tessdataPrefix) {
    customEnv.TESSDATA_PREFIX = options.tessdataPrefix;
  }

  return limiter.run(async () => {
    try {
      const { stdout } = await executor(binary, args, {
        timeout: timeoutMs,
        maxBuffer,
        env: customEnv,
      });
      return stdout;
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        throw new OcrMissingBinaryError(getInstallationInstructions());
      }
      if (err?.killed && err?.signal === "SIGTERM") {
        throw new OcrTimeoutError(timeoutMs);
      }
      if (err?.name === "OcrTimeoutError" || err instanceof OcrTimeoutError) {
        throw err;
      }
      throw new OcrExecutionError(
        `Tesseract OCR execution failed: ${err?.message || String(err)}`,
        err?.code ?? null
      );
    }
  });
}
