export type CloneRole = 'target' | 'me'

export interface CloneMessage {
  role: CloneRole
  content: string
  createTime: number
}

const CONTENT_FIELDS = [
  'message_content',
  'messageContent',
  'content',
  'msg_content',
  'msgContent',
  'WCDB_CT_message_content',
  'WCDB_CT_messageContent'
]
const COMPRESS_FIELDS = [
  'compress_content',
  'compressContent',
  'compressed_content',
  'WCDB_CT_compress_content',
  'WCDB_CT_compressContent'
]
const LOCAL_TYPE_FIELDS = ['local_type', 'localType', 'type', 'msg_type', 'msgType', 'WCDB_CT_local_type']
const IS_SEND_FIELDS = ['computed_is_send', 'computedIsSend', 'is_send', 'isSend', 'WCDB_CT_is_send']
const SENDER_FIELDS = ['sender_username', 'senderUsername', 'sender', 'WCDB_CT_sender_username']
const CREATE_TIME_FIELDS = [
  'create_time',
  'createTime',
  'createtime',
  'msg_create_time',
  'msgCreateTime',
  'msg_time',
  'msgTime',
  'time',
  'WCDB_CT_create_time'
]

const TYPE_LABELS: Record<number, string> = {
  1: '',
  3: '[图片]',
  34: '[语音]',
  43: '[视频]',
  47: '[表情]',
  49: '[分享]',
  62: '[小视频]',
  10000: '[系统消息]'
}

export function mapRowToCloneMessage(
  row: Record<string, any>,
  myWxid?: string | null
): CloneMessage | null {
  const content = decodeMessageContent(getRowField(row, CONTENT_FIELDS), getRowField(row, COMPRESS_FIELDS))
  const localType = getRowInt(row, LOCAL_TYPE_FIELDS, 1)
  const createTime = getRowInt(row, CREATE_TIME_FIELDS, 0)
  const senderUsername = getRowField(row, SENDER_FIELDS)
  const isSendRaw = getRowField(row, IS_SEND_FIELDS)
  let isSend = isSendRaw === null ? null : parseInt(String(isSendRaw), 10)

  if (senderUsername && myWxid) {
    const senderLower = String(senderUsername).toLowerCase()
    const myLower = myWxid.toLowerCase()
    if (isSend === null) {
      isSend = senderLower === myLower ? 1 : 0
    }
  }

  const parsedContent = parseMessageContent(content, localType)
  if (!parsedContent) return null

  const role: CloneRole = isSend === 1 ? 'me' : 'target'
  return { role, content: parsedContent, createTime }
}

export function parseMessageContent(content: string, localType: number): string {
  if (!content) {
    return TYPE_LABELS[localType] || ''
  }
  if (Buffer.isBuffer(content as unknown)) {
    content = (content as unknown as Buffer).toString('utf-8')
  }
  if (localType === 1) {
    return stripSenderPrefix(content)
  }
  return TYPE_LABELS[localType] || content
}

function stripSenderPrefix(content: string): string {
  const trimmed = content.trim()
  const separatorIdx = trimmed.indexOf(':\n')
  if (separatorIdx > 0 && separatorIdx < 64) {
    return trimmed.slice(separatorIdx + 2).trim()
  }
  return trimmed
}

function decodeMessageContent(raw: unknown, compressed: unknown): string {
  const source = raw ?? compressed
  if (source == null) return ''
  if (typeof source === 'string') return source
  if (Buffer.isBuffer(source)) return source.toString('utf-8')
  try {
    return String(source)
  } catch {
    return ''
  }
}

function getRowField(row: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key]
  }
  return null
}

function getRowInt(row: Record<string, any>, keys: string[], fallback: number): number {
  const raw = getRowField(row, keys)
  if (raw === null || raw === undefined) return fallback
  const parsed = parseInt(String(raw), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
