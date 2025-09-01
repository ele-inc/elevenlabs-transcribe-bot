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

  const prompt = `以下の文字起こし結果を分析して、各話者（speaker_0, speaker_1など）が誰なのかを判定してください。

話者候補:
${speakerNames.map((name, i) => `- ${name}`).join('\n')}

文字起こし結果:
${transcript}

各話者の発言内容、話し方、文脈から判断して、以下の形式でJSONを返してください:
{
  "speaker_0": "判定した名前",
  "speaker_1": "判定した名前"
}

注意:
- 必ず候補の名前から選んでください
- 判定が難しい場合でも、最も可能性が高い名前を選んでください
- レスポンスはJSONのみで、説明は不要です`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "あなたは文字起こし結果から話者を特定する専門家です。与えられた候補者リストから、各話者が誰なのかを正確に判定してください。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
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
