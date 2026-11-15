import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormattedMessage } from "../FormattedMessage";

describe("FormattedMessage", () => {
  const dummyCitations = [
    {
      chunkId: "chunk-1",
      documentId: "doc-1",
      filename: "Project_Atlas.pdf",
      pageNumber: 4,
      chunkIndex: 0,
      similarity: 0.95,
    },
    {
      chunkId: "chunk-2",
      documentId: "doc-2",
      filename: "System_Architecture.docx",
      pageNumber: 12,
      chunkIndex: 1,
      similarity: 0.88,
    },
  ];

  it("renders basic Markdown formatting (bold, headings, bullet lists, paragraphs)", () => {
    const markdownText = `# Main Title

## Section Heading

### Subsection

This is a paragraph with **bold text** inside.

Key points:
- Bullet item one
- Bullet item two`;

    const { container } = render(<FormattedMessage text={markdownText} citations={[]} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Main Title");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Section Heading");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Subsection");

    expect(screen.getByText("bold text").tagName).toBe("STRONG");
    expect(screen.getByText("Bullet item one")).toBeTruthy();
    expect(screen.getByText("Bullet item two")).toBeTruthy();
    expect(container.querySelector("ul")).toBeTruthy();
  });

  it("converts [source:1] citation reference into inline citation chip", () => {
    const text = "According to the report [source:1], the project is operational.";
    render(<FormattedMessage text={text} citations={dummyCitations} />);

    const chip = screen.getByTestId("citation-chip-1");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe("[1]");
    expect(chip.getAttribute("title")).toBe("Project_Atlas.pdf · page 4");
  });

  it("renders multiple inline citations [source:1] and [source:2]", () => {
    const text = "Phase 1 is complete [source:1] and Phase 2 is in progress [source:2].";
    render(<FormattedMessage text={text} citations={dummyCitations} />);

    const chip1 = screen.getByTestId("citation-chip-1");
    const chip2 = screen.getByTestId("citation-chip-2");

    expect(chip1.textContent).toBe("[1]");
    expect(chip1.getAttribute("title")).toBe("Project_Atlas.pdf · page 4");

    expect(chip2.textContent).toBe("[2]");
    expect(chip2.getAttribute("title")).toBe("System_Architecture.docx · page 12");
  });

  it("safely handles invalid / out-of-range citation references without crashing or inventing citations", () => {
    const text = "Out of range reference [source:99] and invalid reference [source:0] and text [source:abc].";
    render(<FormattedMessage text={text} citations={dummyCitations} />);

    expect(screen.queryByTestId("citation-chip-99")).toBeNull();
    expect(screen.queryByTestId("citation-chip-0")).toBeNull();

    expect(screen.getByText(/\[source:99\]/)).toBeTruthy();
    expect(screen.getByText(/\[source:0\]/)).toBeTruthy();
    expect(screen.getByText(/\[source:abc\]/)).toBeTruthy();
  });

  it("handles partially streamed Markdown and citation markers safely without crashing", () => {
    const text1 = "The **project status is [source:";
    const { rerender } = render(<FormattedMessage text={text1} citations={dummyCitations} />);
    expect(screen.getByText(/The \*\*project status is \[source:/)).toBeTruthy();

    const text2 = "The **project status** is [source:1].";
    rerender(<FormattedMessage text={text2} citations={dummyCitations} />);
    expect(screen.getByText("project status").tagName).toBe("STRONG");
    expect(screen.getByTestId("citation-chip-1")).toBeTruthy();
  });
});
