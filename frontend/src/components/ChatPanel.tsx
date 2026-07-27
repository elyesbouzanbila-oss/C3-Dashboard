import { useState, useRef, useEffect, useCallback } from 'react'
import { Icon } from './Icon'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: '👋 Hi! I\'m the AI assistant for your cluster. Ask me about pods, policies, security, threats, or anything about your Kubernetes environment.',
}

export function ChatPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Check AI status on mount
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/ai/status`)
      .then(res => res.json())
      .then(data => setAiEnabled(data.enabled))
      .catch(() => setAiEnabled(false))
  }, [])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [open])

  // Keyboard shortcut: Cmd+K or Ctrl+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    const userMessage: ChatMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMessage])
    setLoading(true)

    // Build messages array for the API (excluding welcome message, max 10 for context freshness)
    const apiMessages = [...messages.slice(Math.max(1, messages.length - 9)), userMessage].map(m => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, context: true }),
      })
      const data = await res.json()
      const reply: ChatMessage = { role: 'assistant', content: data.reply || 'No response.' }
      setMessages(prev => [...prev, reply])
    } catch {
      const reply: ChatMessage = {
        role: 'assistant',
        content: '⚠️ Failed to reach the AI backend. Make sure the backend is running.',
      }
      setMessages(prev => [...prev, reply])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      sendMessage()
    },
    [sendMessage]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  const clearChat = useCallback(() => {
    setMessages([WELCOME_MESSAGE])
    setInput('')
  }, [])

  return (
    <>
      {/* Toggle button */}
      <button
        className={`chat-toggle ${open ? 'chat-toggle-open' : ''}`}
        onClick={() => setOpen(prev => !prev)}
        title={`${open ? 'Close' : 'Open'} AI Chat (⌘K)`}
        aria-label={`${open ? 'Close' : 'Open'} AI chat`}
      >
        {open ? (
          <Icon name="x" size={20} />
        ) : (
          <span className="chat-toggle-icon">
            <Icon name="message-circle" size={22} />
            {aiEnabled === false && <span className="chat-toggle-dot" />}
          </span>
        )}
      </button>

      {/* Chat panel */}
      <div className={`chat-panel ${open ? 'chat-panel-open' : ''}`} role="dialog" aria-label="AI Chat">
        {/* Header */}
        <div className="chat-panel-header">
          <div className="chat-panel-header-left">
            <Icon name="bot" size={18} />
            <span>AI Assistant</span>
          </div>
          <div className="chat-panel-header-right">
            {aiEnabled === false && (
              <span className="chat-panel-status-dot status-warn" title="AI not configured" />
            )}
            {aiEnabled === true && (
              <span className="chat-panel-status-dot status-ok" title="AI ready" />
            )}
            <button className="chat-panel-header-btn" onClick={clearChat} title="Clear chat" aria-label="Clear chat">
              <Icon name="trash-2" size={14} />
            </button>
            <button className="chat-panel-header-btn" onClick={() => setOpen(false)} title="Close" aria-label="Close chat">
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-panel-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
              <div className="chat-msg-avatar">
                {msg.role === 'assistant' ? (
                  <Icon name="bot" size={14} />
                ) : (
                  <Icon name="user" size={14} />
                )}
              </div>
              <div className="chat-msg-content">
                <div className="chat-msg-text">{renderContent(msg.content)}</div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-msg-avatar">
                <Icon name="bot" size={14} />
              </div>
              <div className="chat-msg-content">
                <div className="chat-typing">
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form className="chat-panel-input" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="chat-input"
            placeholder="Ask about your cluster..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            aria-label="Chat input"
          />
          <button
            type="submit"
            className="chat-send-btn"
            disabled={!input.trim() || loading}
            aria-label="Send message"
          >
            <Icon name="send" size={16} />
          </button>
        </form>

        {/* Footer hint */}
        <div className="chat-panel-footer">
          <span>⌘K to toggle · AI may be inaccurate</span>
        </div>
      </div>
    </>
  )
}

/** Simple markdown-like rendering for basic formatting */
function renderContent(text: string): React.ReactNode {
  // Split by code blocks
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const code = part.replace(/```(\w*)\n?/, '').replace(/```$/, '')
      return (
        <pre key={i} className="chat-code-block">
          <code>{code}</code>
        </pre>
      )
    }
    // Bold text
    let formatted = part.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>')
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br/>')
    return <span key={i} dangerouslySetInnerHTML={{ __html: formatted }} />
  })
}
