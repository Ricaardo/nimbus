export interface InboundMsg {
  channel: string
  chatId: string
  messageId: string
  user: string
  userId: string
  ts: string
  content: string
  attachments?: string[]
}

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

/** Channel-agnostic rich-card spec. Discord renders as an embed; channels
 *  without embed support fall back to formatted text. */
export interface EmbedSpec {
  title?: string
  description?: string
  /** 0xRRGGBB integer; use buildEmbed() semantic colors. */
  color?: number
  fields?: EmbedField[]
  footer?: string
}

export interface SendOpts {
  replyTo?: string
  files?: string[]
  embed?: EmbedSpec
}

export interface HistoryEntry {
  id: string
  author: string
  ts: string
  content: string
  attachments: number
}

export interface Channel {
  id: string
  /** False for channels that can't stream edits (e.g. weixin via hub). The
   *  dispatcher then skips the streaming placeholder and sends one final
   *  message. Defaults to true (streaming) when omitted. */
  streaming?: boolean
  start(): Promise<void>
  onMessage(cb: (m: InboundMsg) => void): void
  send(chatId: string, text: string, opts?: SendOpts): Promise<string>
  edit(chatId: string, msgId: string, text: string): Promise<void>
  react(chatId: string, msgId: string, emoji: string): Promise<void>
  fetchHistory(chatId: string, limit: number): Promise<HistoryEntry[]>
  download(chatId: string, msgId: string): Promise<string[]>
  sendTyping(chatId: string): Promise<void>
  destroy(): void
}
