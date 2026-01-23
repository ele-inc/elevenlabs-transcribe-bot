import { GoogleGenerativeAI } from "npm:@google/generative-ai";

let geminiClient: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    const apiKey = Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY");
    if (!apiKey) {
      throw new Error(
        "GOOGLE_GENERATIVE_AI_API_KEY is not set in environment variables"
      );
    }
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  return geminiClient;
}

const MODEL_NAME = "gemini-3-flash-preview";

export async function identifySpeakers(
  transcript: string,
  speakerNames: string[]
): Promise<Map<string, string>> {
  const client = getGeminiClient();
  const model = client.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const detectedLabels = extractSpeakerLabels(transcript);
  const labelsToMap =
    detectedLabels.length > 0 ? detectedLabels : ["speaker_0", "speaker_1"];

  const speakerListString = speakerNames.join(", ");
  const labelsListString = labelsToMap.join(", ");

  const exampleJson = `{
${labelsToMap
  .map((l) => `  "${l}": "（ここに候補リストから選んだ名前）"`)
  .join(",\n")}
}`;

  const systemInstruction =
    "あなたは、与えられた「話者候補リスト」に厳密に従って、文字起こしから話者を特定する専門家です。候補リストにない名前は絶対に使用してはいけません。";

  const prompt = `以下の文字起こし結果と話者候補リストを分析し、各話者ラベルが誰なのかを特定してください。

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
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction,
    });

    const response = result.response;
    const resultText = response.text();
    if (!resultText) {
      throw new Error("Gemini API returned empty response");
    }

    const rawMapping = JSON.parse(resultText) as Record<string, string>;

    const mapping: [string, string][] = labelsToMap
      .filter(
        (label) =>
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
  speakerMapping: Map<string, string>
): string {
  let result = transcript;

  const sortedEntries = Array.from(speakerMapping.entries()).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [speakerLabel, name] of sortedEntries) {
    const regex = new RegExp(`\\b${escapeRegExp(speakerLabel)}\\b`, "g");
    result = result.replace(regex, name);
  }

  return result;
}

function extractSpeakerLabels(transcript: string): string[] {
  const labels = new Set<string>();
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

export async function summarizeTranscript(transcript: string): Promise<string> {
  const client = getGeminiClient();
  const model = client.getGenerativeModel({ model: MODEL_NAME });

  const systemInstruction =
    "あなたは会議や打ち合わせの要点を簡潔にまとめる日本語アシスタントです。重要事項を漏れなく整理します。";

  const prompt = `以下の文字起こしを読み、重要なポイントを日本語要約してください。

# 出力要件
- 具体的な数値や決定事項があれば含めてください。
- 不明点や次のアクションがあれば明記してください。

# 文字起こし
${transcript}`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction,
    });

    const response = result.response;
    const summary = response.text()?.trim();

    if (!summary) {
      throw new Error("Gemini API returned empty summary");
    }

    return summary;
  } catch (error) {
    console.error("Error summarizing transcript:", error);
    throw error;
  }
}
