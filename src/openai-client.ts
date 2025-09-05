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
  speakerNames: string[]
): Promise<Map<string, string>> {
  const client = getOpenAIClient();

  const speakerListString = speakerNames.join(", ");

  const prompt = `以下の文字起こし結果と話者候補リストを分析し、各話者（例: speaker_0, speaker_1）が誰なのかを特定してください。

# 話者候補リスト
${speakerNames.map((name) => `- ${name}`).join("\n")}

# 文字起こし結果
${transcript}

# 指示とルール
1. 各話者の発言内容、一人称、文脈、名前の候補から推測される性別、お互いの呼び名などから、その話者が「話者候補リスト」の誰に該当するかを判断してください。
2. **最重要**: JSONの各値は、必ず以下の「話者候補リスト」の中から選択してください。
   【利用可能な名前: ${speakerListString}】
3. 「話者候補リスト」に存在しない名前は、たとえ文字起こし中に出現したとしても、絶対に使用してはいけません。
4. 判定が難しい場合でも、最も可能性が高いと思われる候補を選択してください。
5. 以下のJSON形式で、説明や他のテキストを一切含めずに出力してください。

{
  "speaker_0": "（ここに候補リストから選んだ名前）",
  "speaker_1": "（ここに候補リストから選んだ名前）"
}
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
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const result = response.choices[0].message.content;
    if (!result) {
      throw new Error("OpenAI API returned empty response");
    }

    const speakerMapping = JSON.parse(result);
    return new Map(Object.entries(speakerMapping));
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

  // Sort by speaker label length (descending) to avoid partial replacements
  const sortedEntries = Array.from(speakerMapping.entries())
    .sort((a, b) => b[0].length - a[0].length);

  for (const [speakerLabel, name] of sortedEntries) {
    // Replace all occurrences of the speaker label with the name
    const regex = new RegExp(`\\b${speakerLabel}\\b`, 'g');
    result = result.replace(regex, name);
  }

  return result;
}
