/**
 * Simplified response metadata — wraps tool responses with character count.
 * Stripped-down version of CC MCP's withResponseSize (no context health, sessions, or signals).
 */

interface ToolContent {
  type: "text";
  text: string;
}

interface ToolResult {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

function measureContentChars(content: ToolContent[]): number {
  let total = 0;
  for (const item of content) {
    if (item.type === "text") {
      total += item.text.length;
    }
  }
  return total;
}

export function withResponseSize(result: ToolResult): ToolResult {
  const chars = measureContentChars(result.content);

  const metadata = {
    _responseSize: chars,
  };

  // Append metadata as a JSON suffix on the last text block
  const lastIdx = result.content.length - 1;
  if (lastIdx >= 0 && result.content[lastIdx].type === "text") {
    result.content[lastIdx].text += JSON.stringify(metadata);
  }

  return result;
}
