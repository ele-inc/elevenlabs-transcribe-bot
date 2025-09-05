/**
 * Slack-related types
 */

export interface SlackFile {
  id?: string;
  name: string;
  title?: string;
  mimetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
  duration?: number;
  permalink?: string;
}

export interface SlackEvent {
  type: string;
  subtype?: string;
  channel: string;
  channel_type?: string;
  user: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  files?: SlackFile[];
  bot_id?: string;
  app_id?: string;
  team?: string;
  event_ts?: string;
}

export interface SlackMessage {
  channel: string;
  text?: string;
  thread_ts?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<unknown>;
  block_id?: string;
}

export interface SlackAttachment {
  color?: string;
  text?: string;
  pretext?: string;
  footer?: string;
  fields?: Array<{
    title: string;
    value: string;
    short?: boolean;
  }>;
}