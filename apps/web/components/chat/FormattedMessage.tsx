"use client";

import React from "react";
import type { useChatStream } from "@/hooks/use-chat-stream";

type Citation = ReturnType<typeof useChatStream>["state"]["citations"][number];

interface FormattedMessageProps {
  text: string;
  citations?: Citation[];
  onCitationClick?: (citation: Citation, index: number) => void;
}

function parseBold(text: string): React.ReactNode[] {
  if (!text) return [];

  const boldRegex = /\*\*(.*?)\*\*/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const fullMatch = match[0];
    const boldText = match[1];

    if (matchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, matchIndex));
    }

    nodes.push(
      <strong key={`bold-${matchIndex}`} className="font-semibold text-[var(--text-primary)]">
        {boldText}
      </strong>,
    );

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function parseInline(
  text: string,
  citations: Citation[] = [],
  onCitationClick?: (citation: Citation, index: number) => void,
): React.ReactNode[] {
  if (!text) return [];

  // Match [source:N] or [N] (e.g. [1])
  const sourceRegex = /\[(?:source:)?(\d+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sourceRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const fullMatch = match[0];
    const sourceNumStr = match[1];
    const sourceNum = parseInt(sourceNumStr, 10);

    if (matchIndex > lastIndex) {
      const precedingText = text.slice(lastIndex, matchIndex);
      parts.push(...parseBold(precedingText));
    }

    const citationIndex = sourceNum - 1;
    const citation =
      citations && citationIndex >= 0 && citationIndex < citations.length
        ? citations[citationIndex]
        : undefined;

    if (citation) {
      const title = `${citation.filename}${citation.pageNumber ? ` · page ${citation.pageNumber}` : ""}`;
      parts.push(
        <button
          key={`citation-${matchIndex}-${sourceNum}`}
          type="button"
          onClick={() => onCitationClick?.(citation, citationIndex)}
          className="inline-flex items-center rounded border border-[var(--border-color)] bg-[var(--bg-surface-2)] px-1.5 py-0.5 text-xs font-semibold text-[var(--accent)] mx-0.5 select-none hover:bg-[var(--accent-light)] hover:border-[var(--accent)] transition-colors cursor-pointer"
          title={title}
          data-testid={`citation-chip-${sourceNum}`}
        >
          [{sourceNum}]
        </button>,
      );
    } else {
      parts.push(...parseBold(fullMatch));
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    parts.push(...parseBold(remainingText));
  }

  return parts;
}

export function FormattedMessage({ text, citations = [], onCitationClick }: FormattedMessageProps) {
  if (!text) return null;

  const rawBlocks = text.split(/\n\s*\n/);

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {rawBlocks.map((blockText, blockIdx) => {
        const trimmed = blockText.trim();
        if (!trimmed) return null;

        if (trimmed.startsWith("# ")) {
          const headingText = trimmed.replace(/^#\s+/, "");
          return (
            <h1 key={blockIdx} className="text-base font-bold text-[var(--text-primary)] mt-3 mb-1">
              {parseInline(headingText, citations, onCitationClick)}
            </h1>
          );
        }

        if (trimmed.startsWith("## ")) {
          const headingText = trimmed.replace(/^##\s+/, "");
          return (
            <h2 key={blockIdx} className="text-sm font-bold text-[var(--text-primary)] mt-2 mb-1">
              {parseInline(headingText, citations, onCitationClick)}
            </h2>
          );
        }

        if (trimmed.startsWith("### ")) {
          const headingText = trimmed.replace(/^###\s+/, "");
          return (
            <h3 key={blockIdx} className="text-sm font-semibold text-[var(--text-primary)] mt-2 mb-1">
              {parseInline(headingText, citations, onCitationClick)}
            </h3>
          );
        }

        const lines = trimmed.split("\n");
        const elements: React.ReactNode[] = [];
        let currentBullets: string[] = [];
        let paragraphLines: string[] = [];

        const flushParagraph = (key: string) => {
          if (paragraphLines.length > 0) {
            elements.push(
              <p key={key} className="text-[var(--text-primary)]">
                {paragraphLines.map((line, lIdx) => (
                  <React.Fragment key={lIdx}>
                    {parseInline(line, citations, onCitationClick)}
                    {lIdx < paragraphLines.length - 1 && <br />}
                  </React.Fragment>
                ))}
              </p>,
            );
            paragraphLines = [];
          }
        };

        const flushBullets = (key: string) => {
          if (currentBullets.length > 0) {
            elements.push(
              <ul key={key} className="list-disc list-inside space-y-1 my-1.5 pl-1">
                {currentBullets.map((item, bIdx) => (
                  <li key={bIdx} className="text-[var(--text-primary)]">
                    {parseInline(item, citations, onCitationClick)}
                  </li>
                ))}
              </ul>,
            );
            currentBullets = [];
          }
        };

        lines.forEach((line, lineIdx) => {
          const lTrim = line.trim();
          if (lTrim.startsWith("- ") || lTrim.startsWith("* ")) {
            flushParagraph(`p-${blockIdx}-${lineIdx}`);
            currentBullets.push(lTrim.replace(/^[-*]\s+/, ""));
          } else {
            flushBullets(`ul-${blockIdx}-${lineIdx}`);
            if (lTrim.length > 0) {
              paragraphLines.push(line);
            }
          }
        });

        flushParagraph(`p-final-${blockIdx}`);
        flushBullets(`ul-final-${blockIdx}`);

        return <React.Fragment key={blockIdx}>{elements}</React.Fragment>;
      })}
    </div>
  );
}
