import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User, Loader2, Settings, X, Plus, MessageSquare, Trash2 } from 'lucide-react'
import './App.css'

function App() {
  const STORAGE_KEY = 'ai_chatbot_history_v1'

  const createChat = () => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: 'New chat',
    createdAt: Date.now(),
    messages: [],
  })

  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '')
  const [selectedModel, setSelectedModel] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState('idle')
  const [apiKeyStatusMessage, setApiKeyStatusMessage] = useState('')
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [chats, setChats] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return [createChat()]
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed) || parsed.length === 0) return [createChat()]
      return parsed
    } catch {
      return [createChat()]
    }
  })
  const [activeChatId, setActiveChatId] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id
    } catch {
      // ignore
    }
    return ''
  })
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef(null)

  const activeChat = useMemo(() => {
    return chats.find((c) => c.id === activeChatId) || chats[0]
  }, [chats, activeChatId])

  useEffect(() => {
    if (!activeChatId && chats[0]?.id) {
      setActiveChatId(chats[0].id)
    }
  }, [activeChatId, chats])

  useEffect(() => {
    if (!activeChat) return
    setMessages(Array.isArray(activeChat.messages) ? activeChat.messages : [])
  }, [activeChatId, activeChat])

  useEffect(() => {
    // Changing API key can change available models; force re-resolve.
    setSelectedModel('')
  }, [apiKey])

  useEffect(() => {
    let cancelled = false

    const validate = async () => {
      if (!apiKey || !apiKey.trim()) {
        setApiKeyStatus('idle')
        setApiKeyStatusMessage('')
        return
      }

      setApiKeyStatus('checking')
      setApiKeyStatusMessage('Checking API key…')

      try {
        const modelName = await resolveSupportedModel()
        if (cancelled) return
        setApiKeyStatus('valid')
        setApiKeyStatusMessage(`OK · Using ${modelName.replace('models/', '')}`)
      } catch (err) {
        if (cancelled) return
        setApiKeyStatus('invalid')
        setApiKeyStatusMessage(err?.message ? String(err.message) : 'Invalid API key / API not enabled')
      }
    }

    const timer = setTimeout(() => {
      validate()
    }, 600)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [apiKey])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats))
    } catch {
      // ignore
    }
  }, [chats])

  const upsertActiveChatMessages = (nextMessages) => {
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== activeChatId) return c

        let nextTitle = c.title
        if (!nextTitle || nextTitle === 'New chat') {
          const firstUser = nextMessages.find((m) => m.role === 'user')
          if (firstUser?.content) {
            nextTitle = String(firstUser.content).slice(0, 28)
          }
        }

        return {
          ...c,
          title: nextTitle,
          messages: nextMessages,
        }
      }),
    )
  }

  const handleNewChat = () => {
    const next = createChat()
    setChats((prev) => [next, ...prev])
    setActiveChatId(next.id)
    setMessages([])
    setInput('')
  }

  const handleDeleteChat = (chatId) => {
    setChats((prev) => {
      const filtered = prev.filter((c) => c.id !== chatId)
      const nextList = filtered.length > 0 ? filtered : [createChat()]

      if (chatId === activeChatId) {
        setActiveChatId(nextList[0].id)
        setMessages(Array.isArray(nextList[0].messages) ? nextList[0].messages : [])
        setInput('')
      }

      return nextList
    })
  }

  const handleSelectChat = (chatId) => {
    const found = chats.find((c) => c.id === chatId)
    setActiveChatId(chatId)
    setMessages(Array.isArray(found?.messages) ? found.messages : [])
    setInput('')
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  async function resolveSupportedModel() {
    if (selectedModel) return selectedModel

    const preferred = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-2.0-flash-001',
      'gemini-flash-latest',
      'gemini-pro-latest',
    ]

    const listResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: 'GET' },
    )

    const listData = await listResp.json()

    if (!listResp.ok) {
      const msg = listData?.error?.message || 'Failed to list models'
      throw new Error(msg)
    }

    const models = Array.isArray(listData?.models) ? listData.models : []
    const supported = models
      .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => m.name)

    // API returns names like "models/gemini-2.5-flash".
    const preferredFullNames = preferred.map((id) => `models/${id}`)
    const match = preferredFullNames.find((fullName) => supported.includes(fullName))

    if (!match) {
      throw new Error(
        `No preferred Gemini Flash/Pro model is available for generateContent on this API key/project. Available models: ${supported.join(', ')}`,
      )
    }

    setSelectedModel(match)
    return match
  }

  const handleSendMessage = async () => {
    if (!input.trim()) return
    if (!apiKey.trim()) {
      setShowApiKeyInput(true)
      return
    }

    const userMessage = { role: 'user', content: input }
    setMessages((prev) => {
      const next = [...prev, userMessage]
      upsertActiveChatMessages(next)
      return next
    })
    setInput('')
    setIsLoading(true)

    try {
      const modelName = await resolveSupportedModel()

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: input,
                  },
                ],
              },
            ],
          }),
        },
      )

      const data = await response.json()

      if (!response.ok) {
        const errorMsg = data?.error?.message || `HTTP ${response.status}`
        throw new Error(errorMsg)
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) {
        throw new Error('Empty response from Gemini')
      }

      const botMessage = {
        role: 'assistant',
        content: text,
      }

      setMessages((prev) => {
        const next = [...prev, botMessage]
        upsertActiveChatMessages(next)
        return next
      })
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${error.message}`,
        },
      ])
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">History</div>
          <button className="sidebar-new" onClick={handleNewChat}>
            <Plus size={18} />
            New
          </button>
        </div>

        <div className="chat-list">
          {chats.map((chat) => (
            <button
              key={chat.id}
              className={`chat-list-item ${chat.id === activeChatId ? 'active' : ''}`}
              onClick={() => handleSelectChat(chat.id)}
              type="button"
            >
              <div className="chat-list-item-left">
                <MessageSquare size={16} />
                <span className="chat-list-item-title">{chat.title || 'New chat'}</span>
              </div>
              <span
                className="chat-list-item-delete"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleDeleteChat(chat.id)
                }}
                role="button"
                tabIndex={0}
              >
                <Trash2 size={16} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="chatbot-container">
        <div className="chatbot-header">
          <motion.div 
            className="header-content"
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <div className="bot-info">
              <Bot className="bot-icon" />
              <div>
                <h1>AI Assistant</h1>
                <div className="header-subtitle">{activeChat?.title || 'New chat'}</div>
              </div>
            </div>
            <button 
              className="settings-btn"
              onClick={() => setShowApiKeyInput(!showApiKeyInput)}
            >
              <Settings size={20} />
            </button>
          </motion.div>
        </div>

      <AnimatePresence>
        {showApiKeyInput && (
          <motion.div 
            className="api-key-modal"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h3>API Key Settings</h3>
                <button onClick={() => setShowApiKeyInput(false)}>
                  <X size={20} />
                </button>
              </div>
              <input
                type="password"
                placeholder="Enter your Google Gemini API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="api-key-input"
              />
              <div className={`api-status ${apiKeyStatus}`}>
                {apiKeyStatus === 'checking' && <Loader2 className="api-status-spinner" />}
                <span>{apiKeyStatusMessage}</span>
              </div>
              <p className="api-note">Your API key is stored locally and never shared</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="messages-container">
        <AnimatePresence>
          {messages.length === 0 && (
            <motion.div 
              className="welcome-message"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Bot className="welcome-bot" />
              <h2>Hello! I'm your AI Assistant</h2>
              <p>Ask me anything! Just make sure to set your API key first.</p>
            </motion.div>
          )}
        </AnimatePresence>

        {messages.map((message, index) => (
          <motion.div
            key={index}
            className={`message ${message.role === 'user' ? 'user-message' : 'bot-message'}`}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: index * 0.1 }}
          >
            <div className="message-avatar">
              {message.role === 'user' ? <User size={20} /> : <Bot size={20} />}
            </div>
            <div className="message-content">
              {message.content}
            </div>
          </motion.div>
        ))}

        {isLoading && (
          <motion.div
            className="message bot-message"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="message-avatar">
              <Bot size={20} />
            </div>
            <div className="message-content">
              <Loader2 className="loading-spinner" />
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

        <div className="input-container">
          <motion.div 
            className="input-wrapper"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <input
              type="text"
              placeholder="Type your message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              className="message-input"
            />
            <button 
              onClick={handleSendMessage}
              disabled={isLoading || !input.trim()}
              className="send-button"
            >
              {isLoading ? <Loader2 className="spinner" /> : <Send size={20} />}
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

export default App
