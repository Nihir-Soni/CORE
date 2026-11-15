import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatBox } from "../ChatBox";

let streamState = {
  status: "idle" as "idle" | "connecting" | "streaming" | "complete" | "error",
  answer: "",
  citations: [] as Array<{
    chunkId: string;
    documentId: string;
    filename: string;
    pageNumber?: number | null;
    chunkIndex: number;
    similarity: number;
  }>,
};
const sendMessage = vi.fn();
const cancel = vi.fn();

vi.mock("@/hooks/use-chat-stream", () => ({
  useChatStream: () => ({ state: streamState, sendMessage, cancel }),
}));

describe("ChatBox", () => {
  beforeEach(() => {
    streamState = { status: "idle", answer: "", citations: [] };
    sendMessage.mockReset();
    cancel.mockReset();
  });

  it("submits a question, renders streamed completion with Markdown and citation chips, and displays Sources section", () => {
    const { rerender } = render(<ChatBox documents={[{ status: "READY" } as never]} />);
    const input = screen.getByPlaceholderText("Ask a question about your documents…");

    fireEvent.change(input, { target: { value: "What is in the document?" } });
    fireEvent.submit(input.closest("form")!);

    expect(sendMessage).toHaveBeenCalledWith("What is in the document?", { documentIds: undefined });
    expect(screen.getByText("What is in the document?")).toBeTruthy();

    streamState = {
      status: "complete",
      answer: "It describes **Project Atlas** [source:1] in detail.",
      citations: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          filename: "brief.pdf",
          pageNumber: 3,
          chunkIndex: 0,
          similarity: 0.9,
        },
      ],
    };
    rerender(<ChatBox documents={[{ status: "READY" } as never]} />);

    // Bold text formatted
    expect(screen.getByText("Project Atlas").tagName).toBe("STRONG");
    // Inline citation chip
    expect(screen.getByTestId("citation-chip-1").textContent).toBe("[1]");
    // Sources section at the bottom
    expect(screen.getByText("[1] brief.pdf · page 3")).toBeTruthy();
  });

  it("allows selecting specific documents before asking and passes documentIds to sendMessage", () => {
    const mockDocuments = [
      { id: "doc-1", filename: "Project_Atlas.pdf", status: "READY", sizeBytes: 1024 },
      { id: "doc-2", filename: "Supplier_Contract.pdf", status: "READY", sizeBytes: 2048 },
    ];
    const onScopeChange = vi.fn();

    render(
      <ChatBox
        documents={mockDocuments as never}
        onScopeChange={onScopeChange}
      />
    );

    // Initial state: All Documents
    expect(screen.getByRole("button", { name: /filter documents for chat/i }).textContent).toContain("All Documents (2)");

    // Open scope dropdown
    fireEvent.click(screen.getByRole("button", { name: /filter documents for chat/i }));

    // Check Project Atlas checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]); // Select doc-1

    expect(onScopeChange).toHaveBeenCalledWith(["doc-1"]);

    // Placeholder updates to reflect chosen document
    const input = screen.getByPlaceholderText("Ask a question about Project_Atlas.pdf…");
    expect(input).toBeTruthy();

    // Active scope chip displayed
    expect(screen.getByText("Searching in:")).toBeTruthy();
    expect(screen.getAllByText("Project_Atlas.pdf").length).toBeGreaterThanOrEqual(1);

    // Ask a question
    fireEvent.change(input, { target: { value: "Summarize milestone 1" } });
    fireEvent.submit(input.closest("form")!);

    expect(sendMessage).toHaveBeenCalledWith("Summarize milestone 1", {
      documentIds: ["doc-1"],
    });

    // Remove via chip
    const removeBtn = screen.getByRole("button", { name: "Remove Project_Atlas.pdf from scope" });
    fireEvent.click(removeBtn);
    expect(onScopeChange).toHaveBeenCalledWith([]);
  });

  it("supports multiple document selection and reset to all", () => {
    const mockDocuments = [
      { id: "doc-1", filename: "Doc1.pdf", status: "READY", sizeBytes: 1024 },
      { id: "doc-2", filename: "Doc2.pdf", status: "READY", sizeBytes: 1024 },
    ];
    const onScopeChange = vi.fn();

    render(
      <ChatBox
        documents={mockDocuments as never}
        initialSelectedDocumentIds={["doc-1", "doc-2"]}
        onScopeChange={onScopeChange}
      />
    );

    expect(screen.getByPlaceholderText("Ask a question about the 2 selected documents…")).toBeTruthy();

    // Click "Reset to All"
    const resetBtn = screen.getByRole("button", { name: "Reset to All" });
    fireEvent.click(resetBtn);

    expect(onScopeChange).toHaveBeenCalledWith([]);
    expect(screen.getByPlaceholderText("Ask a question about your documents…")).toBeTruthy();
  });

  it("shows the processing and no-searchable-document guidance", () => {
    const { rerender } = render(<ChatBox documents={[{ status: "PROCESSING" } as never]} />);
    expect(screen.getByText(/1 document is processing/)).toBeTruthy();

    rerender(<ChatBox documents={[]} />);
    expect(screen.getByText(/No searchable documents are available yet/)).toBeTruthy();
  });
});
