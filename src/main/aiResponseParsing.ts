export function parseChatCompletionContent(responseText: string): string {
  let parsed: {
    choices?: Array<{ message?: { content?: string } }>;
  };

  try {
    parsed = JSON.parse(responseText) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
  } catch {
    throw new Error('AI 响应不是有效 JSON。');
  }

  const content = parsed.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('AI 响应中没有可用文本。');
  }

  return content;
}

export function parseOpenAiResponsesContent(responseText: string): string {
  let parsed: {
    output_text?: string;
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  try {
    parsed = JSON.parse(responseText) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
  } catch {
    throw new Error('AI 响应不是有效 JSON。');
  }

  const directText = parsed.output_text?.trim();
  if (directText) {
    return directText;
  }

  const contentText = parsed.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? '')
    .join('')
    .trim();

  if (!contentText) {
    throw new Error('AI 响应中没有可用文本。');
  }

  return contentText;
}

export function parseOpenAiFileUploadId(responseText: string): string {
  let parsed: { id?: string };

  try {
    parsed = JSON.parse(responseText) as { id?: string };
  } catch {
    throw new Error('OpenAI 文件上传响应不是有效 JSON。');
  }

  const fileId = parsed.id?.trim();
  if (!fileId) {
    throw new Error('OpenAI 文件上传响应中没有 file id。');
  }

  return fileId;
}

export function parseKimiFileUploadId(responseText: string): string {
  let parsed: {
    id?: string;
    data?: { id?: string };
  };

  try {
    parsed = JSON.parse(responseText) as {
      id?: string;
      data?: { id?: string };
    };
  } catch {
    throw new Error('Kimi 文件上传响应不是有效 JSON。');
  }

  const fileId = parsed.id?.trim() || parsed.data?.id?.trim();
  if (!fileId) {
    throw new Error('Kimi 文件上传响应中没有 file id。');
  }

  return fileId;
}

export function parseProviderTextPayload(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (!isRecord(parsed)) {
      return responseText;
    }

    const directText = readString(parsed.content) ?? readString(parsed.text);
    if (directText) {
      return directText;
    }

    if (isRecord(parsed.data)) {
      return readString(parsed.data.content) ?? readString(parsed.data.text) ?? responseText;
    }
  } catch {
    return responseText;
  }

  return responseText;
}

export function formatAiErrorBody(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as {
      error?: {
        message?: string;
        type?: string;
        code?: string | number;
      };
    };
    const parts = [parsed.error?.message, parsed.error?.type, parsed.error?.code]
      .filter(Boolean)
      .map((part) => String(part));
    if (parts.length > 0) {
      return parts.join(' / ');
    }
  } catch {
    // 响应不是 JSON 时保留原始短文本，方便排查 provider 返回的错误。
  }

  return responseText.slice(0, 800);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}
