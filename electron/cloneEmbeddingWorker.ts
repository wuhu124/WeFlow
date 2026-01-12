import { parentPort, workerData } from 'worker_threads'
import { join } from 'path'
import { mkdirSync } from 'fs'
import * as lancedb from '@lancedb/lancedb'
import { pipeline, env } from '@xenova/transformers'
import { wcdbService } from './services/wcdbService'
import { mapRowToCloneMessage, CloneMessage, CloneRole } from './services/cloneMessageUtils'

interface WorkerConfig {
  resourcesPath?: string
  userDataPath?: string
  logEnabled?: boolean
  embeddingModel?: string
}

type WorkerRequest =
  | { id: string; type: 'index'; payload: IndexPayload }
  | { id: string; type: 'query'; payload: QueryPayload }

interface IndexPayload {
  sessionId: string
  dbPath: string
  decryptKey: string
  myWxid: string
  batchSize?: number
  chunkGapSeconds?: number
  maxChunkChars?: number
  maxChunkMessages?: number
  reset?: boolean
}

interface QueryPayload {
  sessionId: string
  keyword: string
  topK?: number
  roleFilter?: CloneRole
}

const config = workerData as WorkerConfig
process.env.WEFLOW_WORKER = '1'
if (config.resourcesPath) {
  process.env.WCDB_RESOURCES_PATH = config.resourcesPath
}

wcdbService.setPaths(config.resourcesPath || '', config.userDataPath || '')
wcdbService.setLogEnabled(config.logEnabled === true)

env.allowRemoteModels = true
if (env.backends?.onnx) {
  env.backends.onnx.wasm.enabled = false
}

const embeddingModel = config.embeddingModel || 'Xenova/bge-small-zh-v1.5'
let embedder: any | null = null

async function ensureEmbedder() {
  if (embedder) return embedder
  if (config.userDataPath) {
    env.cacheDir = join(config.userDataPath, 'transformers')
  }
  embedder = await pipeline('feature-extraction', embeddingModel)
  return embedder
}

function getMemoryDir(sessionId: string): string {
  const safeId = sessionId.replace(/[\\/:"*?<>|]+/g, '_')
  const base = config.userDataPath || process.cwd()
  const dir = join(base, 'clone_memory', safeId)
  mkdirSync(dir, { recursive: true })
  return dir
}

async function getTable(sessionId: string, reset?: boolean) {
  const dir = getMemoryDir(sessionId)
  const db = await lancedb.connect(dir)
  const tables = await db.tableNames()
  if (reset && tables.includes('messages')) {
    await db.dropTable('messages')
  }
  const hasTable = tables.includes('messages') && !reset
  return { db, hasTable }
}

function shouldSkipContent(text: string): boolean {
  if (!text) return true
  if (text === '[图片]' || text === '[语音]' || text === '[视频]' || text === '[表情]' || text === '[分享]') {
    return true
  }
  return false
}

function chunkMessages(
  messages: CloneMessage[],
  gapSeconds: number,
  maxChars: number,
  maxMessages: number
) {
  const chunks: Array<{
    role: CloneRole
    content: string
    tsStart: number
    tsEnd: number
    messageCount: number
  }> = []
  let current: typeof chunks[number] | null = null

  for (const msg of messages) {
    if (shouldSkipContent(msg.content)) continue
    if (!current) {
      current = {
        role: msg.role,
        content: msg.content,
        tsStart: msg.createTime,
        tsEnd: msg.createTime,
        messageCount: 1
      }
      continue
    }

    const gap = msg.createTime - current.tsEnd
    const nextContent = `${current.content}\n${msg.content}`
    const roleChanged = msg.role !== current.role
    if (roleChanged || gap > gapSeconds || nextContent.length > maxChars || current.messageCount >= maxMessages) {
      chunks.push(current)
      current = {
        role: msg.role,
        content: msg.content,
        tsStart: msg.createTime,
        tsEnd: msg.createTime,
        messageCount: 1
      }
      continue
    }

    current.content = nextContent
    current.tsEnd = msg.createTime
    current.messageCount += 1
  }

  if (current) {
    chunks.push(current)
  }

  return chunks
}

async function embedTexts(texts: string[]) {
  const model = await ensureEmbedder()
  const output = await model(texts, { pooling: 'mean', normalize: true })
  if (Array.isArray(output)) return output
  if (output?.tolist) return output.tolist()
  return []
}

async function gatherDebugInfo(table: any) {
  try {
    const rowCount = await table.countRows()
    const sample = await table.limit(3).toArray()
    return { rowCount, sample }
  } catch {
    return {}
  }
}

async function handleIndex(requestId: string, payload: IndexPayload) {
  const {
    sessionId,
    dbPath,
    decryptKey,
    myWxid,
    batchSize = 200,
    chunkGapSeconds = 600,
    maxChunkChars = 400,
    maxChunkMessages = 20,
    reset = false
  } = payload

  const openOk = await wcdbService.open(dbPath, decryptKey, myWxid)
  if (!openOk) {
    throw new Error('WCDB open failed')
  }

  const cursorResult = await wcdbService.openMessageCursorLite(sessionId, batchSize, true, 0, 0)
  if (!cursorResult.success || !cursorResult.cursor) {
    throw new Error(cursorResult.error || 'cursor open failed')
  }

  const { db, hasTable } = await getTable(sessionId, reset)
  let table = hasTable ? await db.openTable('messages') : null
  let cursor = cursorResult.cursor
  let hasMore = true
  let chunkId = 0
  let totalMessages = 0
  let totalChunks = 0

  try {
    while (hasMore) {
      const batchResult = await wcdbService.fetchMessageBatch(cursor)
      if (!batchResult.success || !batchResult.rows) {
        throw new Error(batchResult.error || 'fetch batch failed')
      }

      totalMessages += batchResult.rows.length
      const messages: CloneMessage[] = []
      for (const row of batchResult.rows) {
        const msg = mapRowToCloneMessage(row, myWxid)
        if (msg) messages.push(msg)
      }

      const chunks = chunkMessages(messages, chunkGapSeconds, maxChunkChars, maxChunkMessages)
      if (chunks.length > 0) {
        const embeddings = await embedTexts(chunks.map((c) => c.content))
        if (embeddings.length !== chunks.length) {
          throw new Error('embedding size mismatch')
        }
        const rows = chunks.map((chunk, idx) => ({
          id: `${sessionId}-${chunkId + idx}`,
          sessionId,
          role: chunk.role,
          content: chunk.content,
          tsStart: chunk.tsStart,
          tsEnd: chunk.tsEnd,
          messageCount: chunk.messageCount,
          embedding: new Float32Array(embeddings[idx] || [])
        }))
        if (!table) {
          table = await db.createTable('messages', rows)
        } else {
          await table.add(rows)
        }
        chunkId += chunks.length
        totalChunks += chunks.length
      }

      hasMore = batchResult.hasMore === true
      parentPort?.postMessage({
        type: 'event',
        event: 'clone:indexProgress',
        data: { requestId, totalMessages, totalChunks, hasMore }
      })
    }
  } finally {
    await wcdbService.closeMessageCursor(cursor)
    wcdbService.close()
  }

  const debug = await gatherDebugInfo(table)
  return { success: true, totalMessages, totalChunks, debug }
}

async function handleQuery(payload: QueryPayload) {
  const { sessionId, keyword, topK = 5, roleFilter } = payload
  const { db, hasTable } = await getTable(sessionId, false)
  if (!hasTable) {
    return { success: false, error: 'memory table not found' }
  }
  const table = await db.openTable('messages')
  const embeddings = await embedTexts([keyword])
  if (!embeddings.length || !embeddings[0]) {
    return { success: false, error: 'embedding failed' }
  }
  const query = table.search(new Float32Array(embeddings[0] || [])).limit(topK)
  const filtered = roleFilter ? query.where(`role = '${roleFilter}'`) : query
  let rows = await filtered.toArray()
  let usedFallback = false

  if (rows.length === 0) {
    try {
      usedFallback = true
      const lowerKeyword = keyword.trim().toLowerCase()
      const all = await table.toArray()
      rows = all.filter((row) => {
        const content = String(row.content || '').toLowerCase()
        return content.includes(lowerKeyword)
      }).slice(0, topK)
    } catch {
      // fallback remain empty
    }
  }

  const debug = {
    rowsFound: rows.length,
    usedFallback,
    sample: rows.slice(0, 2)
  }

  return { success: true, results: rows, debug }
}

parentPort?.on('message', async (request: WorkerRequest) => {
  try {
    if (request.type === 'index') {
      const data = await handleIndex(request.id, request.payload)
      parentPort?.postMessage({ type: 'response', id: request.id, ok: true, data })
      return
    }
    if (request.type === 'query') {
      const data = await handleQuery(request.payload)
      parentPort?.postMessage({ type: 'response', id: request.id, ok: true, data })
      return
    }
    parentPort?.postMessage({ type: 'response', id: request.id, ok: false, error: 'unknown request' })
  } catch (err) {
    parentPort?.postMessage({ type: 'response', id: request.id, ok: false, error: String(err) })
  }
})
