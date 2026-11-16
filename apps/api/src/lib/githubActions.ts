
import { env } from "@core/shared";

const WORKFLOW_DISPATCH_URL =
    "https://api.github.com/repos/Nihir-Soni/CORE/actions/workflows/document-processing.yml/dispatches";

const WORKFLOW_REF = "main";
const DISPATCH_TIMEOUT_MS = 10_000;

type DispatchOptions = {
    documentId: string;
    token?: string;
};

export async function dispatchDocumentProcessingWorkflow({
    documentId,
    token = env.GITHUB_ACTIONS_TOKEN,
}: DispatchOptions): Promise<boolean> {
    if (!token) {
        console.warn(
            `[GitHub Actions] Dispatch skipped for document ${documentId}: GITHUB_ACTIONS_TOKEN is not configured.`
        );
        return false;
    }

    try {
        const response = await fetch(WORKFLOW_DISPATCH_URL, {
            method: "POST",
            headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ ref: WORKFLOW_REF }),
            signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            console.error(
                `[GitHub Actions] Dispatch failed for document ${documentId}: HTTP ${response.status}.`
            );
            return false;
        }

        console.info(
            `[GitHub Actions] Dispatched document-processing workflow for document ${documentId}.`
        );

        return true;
    } catch (error) {
        const errorName =
            error instanceof Error ? error.name : "UnknownError";

        console.error(
            `[GitHub Actions] Dispatch request failed for document ${documentId}: ${errorName}.`
        );

        return false;
    }
}
