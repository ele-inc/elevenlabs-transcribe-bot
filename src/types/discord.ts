/**
 * Discord-related types
 */

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url?: string;
  content_type?: string;
  description?: string;
  ephemeral?: boolean;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username: string;
    discriminator?: string;
    avatar?: string;
    bot?: boolean;
  };
  content: string;
  timestamp: string;
  edited_timestamp?: string;
  attachments?: DiscordAttachment[];
  embeds?: DiscordEmbed[];
  mentions?: Array<unknown>;
  mention_roles?: string[];
  mention_everyone?: boolean;
  pinned?: boolean;
  type: number;
}

export interface DiscordEmbed {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: {
    text: string;
    icon_url?: string;
  };
  image?: {
    url: string;
    height?: number;
    width?: number;
  };
  thumbnail?: {
    url: string;
    height?: number;
    width?: number;
  };
  video?: {
    url: string;
    height?: number;
    width?: number;
  };
  provider?: {
    name?: string;
    url?: string;
  };
  author?: {
    name?: string;
    url?: string;
    icon_url?: string;
  };
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
}

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  data?: {
    id?: string;
    name?: string;
    options?: Array<{
      name: string;
      value: unknown;
      type: number;
    }>;
    custom_id?: string;
    component_type?: number;
  };
  guild_id?: string;
  channel_id?: string;
  member?: {
    user?: {
      id: string;
      username: string;
      discriminator?: string;
      avatar?: string;
    };
    roles?: string[];
    joined_at?: string;
    nick?: string;
    permissions?: string;
  };
  token: string;
  version?: number;
}