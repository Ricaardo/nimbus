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

export interface SendOpts {
  replyTo?: string
  files?: string[]
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
