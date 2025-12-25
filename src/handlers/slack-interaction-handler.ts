/**
 * Slack interaction handler for buttons and modals
 */

import { openSlackModal, updateSlackModal, sendSlackMessage } from "../clients/slack.ts";
import { okResponse, jsonResponse, badRequest } from "../utils/http-utils.ts";
import { createPlatformAdapter } from "../adapters/platform-adapter.ts";
import { TranscriptionProcessor } from "../services/transcription-processor.ts";
import { TranscriptionOptions } from "../core/types.ts";
import { extractMediaInfo } from "../services/file-processor.ts";

/**
 * Create the transcription options modal view
 * @param diarizeEnabled - Whether speaker diarization is enabled (affects visibility of speaker options)
 * @param currentValues - Current form values to preserve when updating modal
 */
function createTranscriptionModal(
  channelId: string,
  threadTs: string,
  diarizeEnabled: boolean = true,
  currentValues?: {
    url?: string;
    numSpeakers?: string;
    speakerNames?: string;
    timestamp?: string;
    audioEvents?: string;
    summarize?: string;
  }
) {
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: "input",
      block_id: "url_block",
      element: {
        type: "plain_text_input",
        action_id: "url_input",
        placeholder: {
          type: "plain_text",
          text: "https://drive.google.com/... など",
        },
        ...(currentValues?.url && { initial_value: currentValues.url }),
      },
      label: {
        type: "plain_text",
        text: "📎 ファイルURL（必須）",
      },
      hint: {
        type: "plain_text",
        text: "対応: Google Drive, Dropbox, Loom, Vimeo, Utage（公開設定が必要）",
      },
    },
    {
      type: "section",
      block_id: "diarize_block",
      text: {
        type: "mrkdwn",
        text: "*👥 話者分離*",
      },
      accessory: {
        type: "static_select",
        action_id: "diarize_select",
        initial_option: diarizeEnabled
          ? { text: { type: "plain_text", text: "有効" }, value: "true" }
          : { text: { type: "plain_text", text: "無効（1人の場合）" }, value: "false" },
        options: [
          {
            text: { type: "plain_text", text: "有効" },
            value: "true",
          },
          {
            text: { type: "plain_text", text: "無効（1人の場合）" },
            value: "false",
          },
        ],
      },
    },
  ];

  // Only add speaker options if diarize is enabled
  if (diarizeEnabled) {
    blocks.push(
      {
        type: "input",
        block_id: "num_speakers_block",
        optional: true,
        element: {
          type: "static_select",
          action_id: "num_speakers_select",
          initial_option: {
            text: { type: "plain_text", text: `${currentValues?.numSpeakers || "2"}人` },
            value: currentValues?.numSpeakers || "2",
          },
          options: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
            text: { type: "plain_text", text: `${n}人` },
            value: String(n),
          })),
        },
        label: {
          type: "plain_text",
          text: "🔢 話者数",
        },
      },
      {
        type: "input",
        block_id: "speaker_names_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "speaker_names_input",
          placeholder: {
            type: "plain_text",
            text: "田中,山田,佐藤",
          },
          ...(currentValues?.speakerNames && { initial_value: currentValues.speakerNames }),
        },
        label: {
          type: "plain_text",
          text: "📝 話者名（カンマ区切り）",
        },
      }
    );
  }

  // Add remaining options
  blocks.push(
    {
      type: "section",
      block_id: "timestamp_block",
      text: {
        type: "mrkdwn",
        text: "*⏱️ タイムスタンプ*",
      },
      accessory: {
        type: "static_select",
        action_id: "timestamp_select",
        initial_option: (currentValues?.timestamp === "false")
          ? { text: { type: "plain_text", text: "非表示" }, value: "false" }
          : { text: { type: "plain_text", text: "表示" }, value: "true" },
        options: [
          {
            text: { type: "plain_text", text: "表示" },
            value: "true",
          },
          {
            text: { type: "plain_text", text: "非表示" },
            value: "false",
          },
        ],
      },
    },
    {
      type: "section",
      block_id: "audio_events_block",
      text: {
        type: "mrkdwn",
        text: "*🎵 音声イベント（笑い声等）*",
      },
      accessory: {
        type: "static_select",
        action_id: "audio_events_select",
        initial_option: (currentValues?.audioEvents === "false")
          ? { text: { type: "plain_text", text: "非表示" }, value: "false" }
          : { text: { type: "plain_text", text: "表示" }, value: "true" },
        options: [
          {
            text: { type: "plain_text", text: "表示" },
            value: "true",
          },
          {
            text: { type: "plain_text", text: "非表示" },
            value: "false",
          },
        ],
      },
    },
    {
      type: "section",
      block_id: "summarize_block",
      text: {
        type: "mrkdwn",
        text: "*📋 要約生成*",
      },
      accessory: {
        type: "static_select",
        action_id: "summarize_select",
        initial_option: (currentValues?.summarize === "false")
          ? { text: { type: "plain_text", text: "しない" }, value: "false" }
          : { text: { type: "plain_text", text: "する" }, value: "true" },
        options: [
          {
            text: { type: "plain_text", text: "する" },
            value: "true",
          },
          {
            text: { type: "plain_text", text: "しない" },
            value: "false",
          },
        ],
      },
    }
  );

  return {
    type: "modal",
    callback_id: "transcription_modal",
    private_metadata: JSON.stringify({ channelId, threadTs }),
    title: {
      type: "plain_text",
      text: "文字起こし設定",
    },
    submit: {
      type: "plain_text",
      text: "実行",
    },
    close: {
      type: "plain_text",
      text: "キャンセル",
    },
    blocks,
  };
}

/**
 * Create the initial button message for file-less mentions
 */
export function createTranscriptionButtonBlocks() {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "🎙️ *文字起こしボット*\n\n*URLから文字起こし*\n下のボタンから設定・実行できます",
      },
    },
    {
      type: "actions",
      block_id: "transcription_actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "⚙️ URLから文字起こし",
            emoji: true,
          },
          style: "primary",
          action_id: "open_transcription_modal",
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*ファイルから文字起こし*\nファイルを添付して `@bot` にメンションしてください\n\n*オプション（任意）*\n• `--no-diarize` : 話者分離OFF（1人の場合に推奨）\n• `--num-speakers 3` : 話者数を指定\n• `--speaker-names 田中,山田,佐藤` : 話者名を指定(話者数と揃える)\n• `--no-timestamp` : タイムスタンプ非表示\n• `--no-summarize` : 要約をスキップ\n\n例: `@bot --num-speakers 3 --speaker-names 田中,山田,佐藤`",
      },
    },
  ];
}

/**
 * Handle button click to open modal
 */
async function handleButtonClick(payload: {
  trigger_id: string;
  channel: { id: string };
  message: { ts: string };
}) {
  const view = createTranscriptionModal(
    payload.channel.id,
    payload.message.ts
  );

  const result = await openSlackModal(payload.trigger_id, view);
  if (!result.ok) {
    console.error("Failed to open modal:", result.error);
  }
}

/**
 * Parse modal submission values into TranscriptionOptions
 */
function parseModalValues(values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>>): {
  options: TranscriptionOptions;
  url: string | null;
} {
  const getSelectValue = (blockId: string, actionId: string): string | undefined => {
    return values[blockId]?.[actionId]?.selected_option?.value;
  };

  const getInputValue = (blockId: string, actionId: string): string | undefined => {
    return values[blockId]?.[actionId]?.value;
  };

  const diarize = getSelectValue("diarize_block", "diarize_select") !== "false";
  const showTimestamp = getSelectValue("timestamp_block", "timestamp_select") !== "false";
  const tagAudioEvents = getSelectValue("audio_events_block", "audio_events_select") !== "false";
  const summarize = getSelectValue("summarize_block", "summarize_select") !== "false";

  const numSpeakersStr = getSelectValue("num_speakers_block", "num_speakers_select");
  const numSpeakers = numSpeakersStr ? parseInt(numSpeakersStr, 10) : 2;

  const speakerNamesStr = getInputValue("speaker_names_block", "speaker_names_input");
  const speakerNames = speakerNamesStr
    ? speakerNamesStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    : undefined;

  const url = getInputValue("url_block", "url_input") || null;

  return {
    options: {
      diarize,
      showTimestamp,
      tagAudioEvents,
      numSpeakers: diarize ? numSpeakers : undefined,
      speakerNames: diarize && speakerNames?.length ? speakerNames : undefined,
      summarize,
    },
    url,
  };
}

/**
 * Handle modal submission
 */
async function handleModalSubmission(payload: {
  view: {
    private_metadata: string;
    state: {
      values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>>;
    };
  };
  user: { id: string };
}) {
  const { channelId, threadTs } = JSON.parse(payload.view.private_metadata);
  const { options, url } = parseModalValues(payload.view.state.values);

  if (!url) {
    await sendSlackMessage(
      channelId,
      "❌ URLを入力してください。",
      threadTs
    );
    return;
  }

  // Check if URL is valid
  const { cloudUrls } = extractMediaInfo(url);
  if (cloudUrls.length === 0) {
    await sendSlackMessage(
      channelId,
      "❌ 対応していないURLです。Google Drive、YouTube、Dropbox等のURLを入力してください。",
      threadTs
    );
    return;
  }

  // Create adapter and processor
  const adapter = createPlatformAdapter("slack", {
    channelId,
    threadTimestamp: threadTs,
  });

  const processor = new TranscriptionProcessor(adapter, {
    channelId,
    timestamp: threadTs,
    userId: payload.user.id,
  });

  // Process in background
  processor.processTextInput(url, options)
    .catch(console.error)
    .finally(() => processor.cleanup());
}

/**
 * Main Slack interactions handler
 */
export async function handleSlackInteractions(req: Request): Promise<Response> {
  const formData = await req.formData();
  const payloadStr = formData.get("payload");

  if (!payloadStr || typeof payloadStr !== "string") {
    return badRequest("Missing payload");
  }

  const payload = JSON.parse(payloadStr);
  console.log("Slack interaction type:", payload.type);

  // Handle button clicks and select changes
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];

    if (action?.action_id === "open_transcription_modal") {
      await handleButtonClick(payload);
      return okResponse();
    }

    // Handle diarize select change - update modal to show/hide speaker options
    if (action?.action_id === "diarize_select") {
      const diarizeEnabled = action.selected_option?.value === "true";
      const { channelId, threadTs } = JSON.parse(payload.view.private_metadata);
      const values = payload.view.state.values;

      // Extract current values to preserve them
      const currentValues = {
        url: values.url_block?.url_input?.value,
        numSpeakers: values.num_speakers_block?.num_speakers_select?.selected_option?.value,
        speakerNames: values.speaker_names_block?.speaker_names_input?.value,
        timestamp: values.timestamp_block?.timestamp_select?.selected_option?.value,
        audioEvents: values.audio_events_block?.audio_events_select?.selected_option?.value,
        summarize: values.summarize_block?.summarize_select?.selected_option?.value,
      };

      const updatedView = createTranscriptionModal(channelId, threadTs, diarizeEnabled, currentValues);
      const result = await updateSlackModal(payload.view.id, updatedView);
      if (!result.ok) {
        console.error("Failed to update modal:", result.error);
      }
      return okResponse();
    }
  }

  // Handle modal submissions
  if (payload.type === "view_submission") {
    if (payload.view?.callback_id === "transcription_modal") {
      // Respond immediately to avoid timeout
      handleModalSubmission(payload).catch(console.error);
      // Slack requires empty JSON body for view_submission
      return jsonResponse({});
    }
  }

  return okResponse();
}
