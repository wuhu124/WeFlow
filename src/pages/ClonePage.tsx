import { useEffect, useMemo, useState } from 'react'
import { Bot, Search, Wand2, Database, Play, RefreshCw, FileSearch } from 'lucide-react'
import type { ChatSession } from '../types/models'
import * as configService from '../services/config'
import './ClonePage.scss'
import './DataManagementPage.scss'

type ToneGuide = {
  summary?: string
  details?: Record<string, any>
}

type ChatEntry = {
  role: 'user' | 'assistant'
  content: string
}

function ClonePage() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [selectedSession, setSelectedSession] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')

  const [modelPath, setModelPath] = useState('')
  const [modelSaving, setModelSaving] = useState(false)

  const [resetIndex, setResetIndex] = useState(false)
  const [batchSize, setBatchSize] = useState(200)
  const [chunkGapMinutes, setChunkGapMinutes] = useState(10)
  const [maxChunkChars, setMaxChunkChars] = useState(400)
  const [maxChunkMessages, setMaxChunkMessages] = useState(20)
  const [indexing, setIndexing] = useState(false)
  const [indexStatus, setIndexStatus] = useState<{ totalMessages: number; totalChunks: number; hasMore: boolean } | null>(null)

  const [toneGuide, setToneGuide] = useState<ToneGuide | null>(null)
  const [toneLoading, setToneLoading] = useState(false)
  const [toneSampleSize, setToneSampleSize] = useState(500)
  const [toneError, setToneError] = useState<string | null>(null)

  const [queryKeyword, setQueryKeyword] = useState('')
  const [queryResults, setQueryResults] = useState<any[]>([])
  const [queryLoading, setQueryLoading] = useState(false)

  const [chatInput, setChatInput] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([])
  const [chatLoading, setChatLoading] = useState(false)

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const result = await window.electronAPI.chat.getSessions()
        if (!result.success || !result.sessions) {
          setLoadError(result.error || '加载会话失败')
          return
        }
        const privateSessions = result.sessions.filter((s) => !s.username.includes('@chatroom'))
        setSessions(privateSessions)
        if (privateSessions.length > 0) {
          setSelectedSession((prev) => prev || privateSessions[0].username)
        }
      } catch (err) {
        setLoadError(String(err))
      }
    }
    loadSessions()
  }, [])

  useEffect(() => {
    const loadModelPath = async () => {
      const saved = await configService.getLlmModelPath()
      if (saved) setModelPath(saved)
    }
    loadModelPath()
  }, [])

  useEffect(() => {
    const removeListener = window.electronAPI.clone.onIndexProgress?.((payload) => {
      setIndexStatus({
        totalMessages: payload.totalMessages,
        totalChunks: payload.totalChunks,
        hasMore: payload.hasMore
      })
    })
    return () => removeListener?.()
  }, [])

  const sessionLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const session of sessions) {
      map.set(session.username, session.displayName || session.username)
    }
    return map
  }, [sessions])

  const filteredSessions = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    if (!keyword) return sessions
    return sessions.filter((session) => {
      const name = session.displayName || ''
      return (
        name.toLowerCase().includes(keyword) ||
        session.username.toLowerCase().includes(keyword)
      )
    })
  }, [sessions, searchKeyword])

  const getAvatarLetter = (session: ChatSession) => {
    const name = session.displayName || session.username
    if (!name) return '?'
    return [...name][0] || '?'
  }

  const handlePickModel = async () => {
    const result = await window.electronAPI.dialog.openFile({
      title: '选择本地 LLM 模型 (.gguf)',
      filters: [{ name: 'GGUF', extensions: ['gguf'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      setModelPath(result.filePaths[0])
    }
  }

  const handleSaveModel = async () => {
    setModelSaving(true)
    try {
      await configService.setLlmModelPath(modelPath)
    } finally {
      setModelSaving(false)
    }
  }

  const handleIndex = async () => {
    if (!selectedSession) return
    setIndexing(true)
    setIndexStatus(null)
    try {
      await window.electronAPI.clone.indexSession(selectedSession, {
        reset: resetIndex,
        batchSize,
        chunkGapSeconds: Math.max(1, Math.round(chunkGapMinutes * 60)),
        maxChunkChars,
        maxChunkMessages
      })
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setIndexing(false)
    }
  }

  const handleToneGuide = async () => {
    if (!selectedSession) return
    setToneLoading(true)
    setToneError(null)
    try {
      const result = await window.electronAPI.clone.generateToneGuide(selectedSession, toneSampleSize)
      if (result.success) {
        setToneGuide(result.data || null)
      } else {
        setToneError(result.error || '生成失败')
      }
    } finally {
      setToneLoading(false)
    }
  }

  const handleLoadToneGuide = async () => {
    if (!selectedSession) return
    setToneLoading(true)
    setToneError(null)
    try {
      const result = await window.electronAPI.clone.getToneGuide(selectedSession)
      if (result.success) {
        setToneGuide(result.data || null)
      } else {
        setToneError(result.error || '未找到说明书')
      }
    } finally {
      setToneLoading(false)
    }
  }

  const handleQuery = async () => {
    if (!selectedSession || !queryKeyword.trim()) return
    setQueryLoading(true)
    try {
      const result = await window.electronAPI.clone.query({
        sessionId: selectedSession,
        keyword: queryKeyword.trim(),
        options: { topK: 5, roleFilter: 'target' }
      })
      if (result.success) {
        setQueryResults(result.results || [])
      } else {
        setQueryResults([])
      }
    } finally {
      setQueryLoading(false)
    }
  }

  const handleChat = async () => {
    if (!selectedSession || !chatInput.trim()) return
    const message = chatInput.trim()
    setChatInput('')
    setChatHistory((prev) => [...prev, { role: 'user', content: message }])
    setChatLoading(true)
    try {
      const result = await window.electronAPI.clone.chat({ sessionId: selectedSession, message })
      const reply = result.success ? (result.response || '') : result.error || '生成失败'
      setChatHistory((prev) => [...prev, { role: 'assistant', content: reply }])
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>好友克隆</h1>
      </div>

      <div className="page-scroll clone-page">
        <section className="page-section clone-hero">
          <div className="clone-hero-content">
            <div className="clone-hero-title">
              <Bot size={28} />
              <div>
                <h2>私聊分身实验室</h2>
                <p className="section-desc">建立长期记忆、生成性格说明书、通过工具调用检索旧对话。</p>
              </div>
            </div>
            <div className="clone-hero-badges">
              <span>私聊限定</span>
              <span>本地推理</span>
              <span>可解释检索</span>
            </div>
          </div>
          {loadError && <div className="clone-alert">{loadError}</div>}
        </section>

        <section className="page-section">
          <div className="section-header">
            <div>
              <h2>基础配置</h2>
              <p className="section-desc">选择要克隆的好友，并配置本地 LLM 模型。</p>
            </div>
          </div>

          <div className="clone-config clone-config-split">
            <div className="clone-session-panel">
              <div className="clone-panel-header">
                <span>目标好友</span>
                <div className="clone-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="搜索好友"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                  />
                </div>
              </div>

              <div className="clone-session-list">
                {filteredSessions.length === 0 ? (
                  <div className="clone-empty">暂无可用会话</div>
                ) : (
                  filteredSessions.map((session) => (
                    <button
                      key={session.username}
                      className={`clone-session-item ${selectedSession === session.username ? 'active' : ''}`}
                      onClick={() => setSelectedSession(session.username)}
                    >
                      <div className="clone-session-avatar">
                        <span>{getAvatarLetter(session)}</span>
                        {session.avatarUrl && (
                          <img
                            src={session.avatarUrl}
                            alt={session.displayName || session.username}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                            }}
                          />
                        )}
                      </div>
                      <div className="clone-session-info">
                        <div className="clone-session-name">{sessionLabelMap.get(session.username)}</div>
                        <div className="clone-session-meta">{session.username}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="clone-model-panel">
              <label className="clone-label">
                LLM 模型路径 (.gguf)
                <div className="clone-input-row">
                  <input
                    type="text"
                    value={modelPath}
                    onChange={(e) => setModelPath(e.target.value)}
                    placeholder="请选择本地模型路径"
                  />
                  <button className="btn btn-secondary" onClick={handlePickModel}>
                    <FileSearch size={16} />
                    选择
                  </button>
                  <button className="btn btn-primary" onClick={handleSaveModel} disabled={modelSaving}>
                    保存
                  </button>
                </div>
              </label>
              <div className="clone-model-tip">
                建议使用 1.5B 级别 GGUF 模型，首次加载可能需要一些时间。
              </div>
            </div>
          </div>
        </section>

        <div className="clone-grid">
          <section className="page-section">
            <div className="section-header">
              <div>
                <h2>长期记忆索引</h2>
                <p className="section-desc">将私聊消息切片并向量化，建立可检索记忆库。</p>
              </div>
            </div>

            <div className="clone-options">
              <label>
                <span>批大小</span>
                <input type="number" min={50} max={1000} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} />
              </label>
              <label>
                <span>时间间隔 (分钟)</span>
                <input type="number" min={1} max={60} value={chunkGapMinutes} onChange={(e) => setChunkGapMinutes(Number(e.target.value))} />
              </label>
              <label>
                <span>最大字数</span>
                <input type="number" min={100} max={1200} value={maxChunkChars} onChange={(e) => setMaxChunkChars(Number(e.target.value))} />
              </label>
              <label>
                <span>最大条数</span>
                <input type="number" min={5} max={50} value={maxChunkMessages} onChange={(e) => setMaxChunkMessages(Number(e.target.value))} />
              </label>
              <label className="clone-checkbox">
                <input type="checkbox" checked={resetIndex} onChange={(e) => setResetIndex(e.target.checked)} />
                重建索引
              </label>
            </div>

            <div className="clone-actions">
              <button className="btn btn-primary" onClick={handleIndex} disabled={indexing || !selectedSession}>
                {indexing ? <RefreshCw size={16} className="spin" /> : <Database size={16} />}
                开始索引
              </button>
              {indexStatus && (
                <div className="clone-progress">
                  <span>消息 {indexStatus.totalMessages}</span>
                  <span>分片 {indexStatus.totalChunks}</span>
                  <span>{indexStatus.hasMore ? '索引中' : '已完成'}</span>
                </div>
              )}
            </div>
          </section>

          <section className="page-section">
            <div className="section-header">
              <div>
                <h2>性格说明书</h2>
                <p className="section-desc">抽样目标发言，生成可长期驻留的说话风格。</p>
              </div>
            </div>

            <div className="clone-options">
              <label>
                <span>抽样条数</span>
                <input type="number" min={100} max={2000} value={toneSampleSize} onChange={(e) => setToneSampleSize(Number(e.target.value))} />
              </label>
              <div className="clone-actions">
                <button className="btn btn-primary" onClick={handleToneGuide} disabled={toneLoading || !selectedSession}>
                  {toneLoading ? <RefreshCw size={16} className="spin" /> : <Wand2 size={16} />}
                  生成说明书
                </button>
                <button className="btn btn-secondary" onClick={handleLoadToneGuide} disabled={toneLoading || !selectedSession}>
                  读取已有
                </button>
              </div>
            </div>

            {toneError && <div className="clone-alert">{toneError}</div>}
            {toneGuide && (
              <div className="clone-tone">
                <strong>{toneGuide.summary || '未生成摘要'}</strong>
                {toneGuide.details && (
                  <pre>{JSON.stringify(toneGuide.details, null, 2)}</pre>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="page-section">
          <div className="section-header">
            <div>
              <h2>记忆检索测试</h2>
              <p className="section-desc">输入关键词测试向量检索效果。</p>
            </div>
          </div>
          <div className="clone-query">
            <input
              type="text"
              value={queryKeyword}
              onChange={(e) => setQueryKeyword(e.target.value)}
              placeholder="比如：上海、火锅、雨天"
            />
            <button className="btn btn-secondary" onClick={handleQuery} disabled={queryLoading || !selectedSession}>
              {queryLoading ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
              搜索
            </button>
          </div>
          <div className="clone-query-results">
            {queryResults.length === 0 ? (
              <div className="clone-empty">暂无结果</div>
            ) : (
              queryResults.map((item, idx) => (
                <div key={`${item.id || idx}`} className="clone-card">
                  <div className="clone-card-meta">
                    <span>{item.role === 'target' ? '对方' : '我'}</span>
                    <span>消息 {item.messageCount}</span>
                  </div>
                  <div className="clone-card-content">{item.content}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="page-section">
          <div className="section-header">
            <div>
              <h2>分身对话</h2>
              <p className="section-desc">模型会按需调用记忆检索，再用目标口吻回应。</p>
            </div>
          </div>

          <div className="clone-chat">
            <div className="clone-chat-history">
              {chatHistory.length === 0 ? (
                <div className="clone-empty">暂无对话</div>
              ) : (
                chatHistory.map((entry, idx) => (
                  <div key={`${entry.role}-${idx}`} className={`clone-bubble ${entry.role}`}>
                    {entry.content}
                  </div>
                ))
              )}
            </div>
            <div className="clone-chat-input">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="对分身说点什么..."
              />
              <button className="btn btn-primary" onClick={handleChat} disabled={chatLoading || !selectedSession}>
                {chatLoading ? <RefreshCw size={16} className="spin" /> : <Play size={16} />}
                发送
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

export default ClonePage
