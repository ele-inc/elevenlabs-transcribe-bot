import OpenAI from "npm:openai@4.74.0";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set in environment variables");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export async function identifySpeakers(
  transcript: string,
  speakerNames: string[],
): Promise<Map<string, string>> {
  const client = getOpenAIClient();

  // Detect all unique speaker labels present in the transcript
  const detectedLabels = extractSpeakerLabels(transcript);
  const labelsToMap = detectedLabels.length > 0
    ? detectedLabels
    : ["speaker_0", "speaker_1"]; // fallback

  const speakerListString = speakerNames.join(", ");
  const labelsListString = labelsToMap.join(", ");

  const exampleJson = `{
${
    labelsToMap.map((l) => `  "${l}": "（ここに候補リストから選んだ名前）"`)
      .join(",\n")
  }\n}`;

  const prompt =
    `以下の文字起こし結果と話者候補リストを分析し、各話者ラベルが誰なのかを特定してください。

# 話者候補リスト
${speakerNames.map((name) => `- ${name}`).join("\n")}

# 文字起こし結果
${transcript}

# 指示とルール
1. 各話者の発言内容、一人称、文脈、互いの呼称などから、その話者が「話者候補リスト」の誰に該当するかを判断してください。
2. 値として使用できるのは、次の候補名のみです（新しい名前を作らないこと）：【${speakerListString}】
3. 次のラベルに対してのみマッピングを出力してください（追加や欠落は禁止）：【${labelsListString}】
4. 迷う場合でも、最も可能性が高い候補を選択してください（重複選択は可）。
5. 出力はJSONオブジェクトのみ。説明や余分なテキストは禁止。

出力例（キーは検出されたラベルと完全一致させること。以下は例）：
${exampleJson}
`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "あなたは、与えられた「話者候補リスト」に厳密に従って、文字起こしから話者を特定する専門家です。候補リストにない名前は絶対に使用してはいけません。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
    });

    const result = response.choices[0].message.content;
    if (!result) {
      throw new Error("OpenAI API returned empty response");
    }

    const rawMapping = JSON.parse(result) as Record<string, string>;

    // Normalize and filter only expected labels; if missing, skip it
    const mapping: [string, string][] = labelsToMap
      .filter((label) =>
        typeof rawMapping[label] === "string" &&
        rawMapping[label].trim().length > 0
      )
      .map((label) => [label, rawMapping[label].trim()]);

    return new Map(mapping);
  } catch (error) {
    console.error("Error identifying speakers:", error);
    throw error;
  }
}

export function replaceSpeakerLabels(
  transcript: string,
  speakerMapping: Map<string, string>,
): string {
  let result = transcript;

  // Sort by speaker label length (descending) to avoid partial replacements
  const sortedEntries = Array.from(speakerMapping.entries())
    .sort((a, b) => b[0].length - a[0].length);

  for (const [speakerLabel, name] of sortedEntries) {
    // Replace all occurrences of the speaker label with the name
    const regex = new RegExp(`\\b${escapeRegExp(speakerLabel)}\\b`, "g");
    result = result.replace(regex, name);
  }

  return result;
}

// 文字数制限は設けません
export async function summarizeTranscript(transcript: string): Promise<string> {
  const client = getOpenAIClient();

  const prompt =
    `以下の文字起こしを読み、重要なポイントを日本語要約してください。

# 出力要件
- 箇条書きの行頭には「・」を使用してください。
- 具体的な数値や決定事項があれば含めてください。
- 不明点や次のアクションがあれば明記してください。

# 文字起こし
${transcript}`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "あなたは会議や打ち合わせの要点を簡潔にまとめる日本語アシスタントです。重要事項を漏れなく整理します。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const summary = response.choices[0].message.content?.trim();
    if (!summary) {
      throw new Error("OpenAI API returned empty summary");
    }

    return summary;
  } catch (error) {
    console.error("Error summarizing transcript:", error);
    throw error;
  }
}

function extractSpeakerLabels(transcript: string): string[] {
  const labels = new Set<string>();
  // Match labels that appear at the start of a line (optionally after a timestamp), followed by a colon
  // Examples handled:
  //  - "speaker_0: text"
  //  - "1:23 speaker_1: text"
  //  - "01:02:03 unknown_speaker: text"
  const pattern =
    /(?:^|\n)\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s+)?([A-Za-z][\w-]*)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(transcript)) !== null) {
    labels.add(match[1]);
  }
  return Array.from(labels);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
