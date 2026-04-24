/**
 * Slack Block Kit builders for bot responses.
 *
 * - Summary result: header + section(mrkdwn) + optional context meta.
 * - Errors: section with alert prefix + optional context hint.
 *
 * Slack section text has a 3000-char limit; long summaries are split across
 * multiple section blocks. Block Kit payloads also cap at 50 blocks, which
 * is not a concern for short AI summaries.
 */

import { TranscriptionOptions } from "../core/types.ts";
import { generateOptionInfo } from "../services/file-processor.ts";

// deno-lint-ignore no-explicit-any
export type SlackBlock = any;

const SECTION_TEXT_LIMIT = 2900;

/**
 * Convert Gemini-style Markdown to Slack mrkdwn.
 * Patterned after launch-management-system's markdownToSlackText.
 */
export function markdownToMrkdwn(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      out.push(line);
      continue;
    }
    if (inCodeBlock) {
      out.push(line);
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      out.push("━━━━━━━━━━━━━━━");
      continue;
    }

    const headerMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headerMatch) {
      out.push(`*${headerMatch[1].trim()}*`);
      continue;
    }

    const converted = line
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
      .replace(/^(\s*)[-*]\s+/, "$1• ");

    out.push(converted);
  }

  return out.join("\n");
}

/**
 * Split long text into chunks under Slack's section-text limit.
 * Breaks on blank lines when possible to keep paragraphs intact.
 */
function splitForSection(text: string, maxLen: number = SECTION_TEXT_LIMIT): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = para;
    } else if (candidate.length > maxLen) {
      // single paragraph too long — hard-split by lines
      const lines = para.split("\n");
      for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > maxLen && current) {
          chunks.push(current);
          current = line;
        } else {
          current = next;
        }
      }
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function section(mrkdwn: string): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text: mrkdwn },
  };
}

function context(mrkdwn: string): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: mrkdwn }],
  };
}

function header(text: string): SlackBlock {
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  };
}

function divider(): SlackBlock {
  return { type: "divider" };
}

/**
 * Build the summary result message as Block Kit.
 */
export function buildSummaryBlocks({
  summary,
  filename,
  options,
}: {
  summary: string;
  filename?: string;
  options?: TranscriptionOptions;
}): SlackBlock[] {
  const blocks: SlackBlock[] = [header("📝 文字起こし要約")];

  if (filename) {
    blocks.push(context(`*ファイル:* ${filename}`));
  }

  blocks.push(divider());

  const mrkdwn = markdownToMrkdwn(summary);
  for (const chunk of splitForSection(mrkdwn)) {
    blocks.push(section(chunk));
  }

  if (options) {
    const info = generateOptionInfo(options);
    if (info.length > 0) {
      blocks.push(context(`⚙️ ${info.join(" / ")}`));
    }
  }

  return blocks;
}

/**
 * Build an error message as Block Kit.
 */
export function buildErrorBlocks(message: string, hint?: string): SlackBlock[] {
  const blocks: SlackBlock[] = [section(`⚠️ *エラー*\n${message}`)];
  if (hint) {
    blocks.push(context(hint));
  }
  return blocks;
}

/**
 * Plain-text fallback used in the `text` field alongside `blocks`.
 * Shown in notifications and when Block Kit can't be rendered.
 */
export function summaryFallbackText(filename?: string): string {
  return filename
    ? `📝 "${filename}" の要約`
    : "📝 文字起こし要約";
}
