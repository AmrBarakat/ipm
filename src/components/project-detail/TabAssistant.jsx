import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { formatDate } from '@/lib/constants';
import { Plus, Send, Loader2, Bot, User, AlertTriangle, Lightbulb, MessageSquare, Sparkles } from 'lucide-react';

function parseAssistant(content) {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj.answer === 'string') return obj;
  } catch (_) { /* not json */ }
  return null;
}

export default function TabAssistant({ projectId }) {
  const queryClient = useQueryClient();
  const { data: conversations = [], isLoading: loadingConvs } = useEntityList('Conversation', { project_id: projectId }, '-created_date', 200);
  const convMutation = useEntityMutation('Conversation');

  const [selectedId, setSelectedId] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const messagesFilter = { conversation_id: selectedId || '__none__' };
  const { data: messages = [], isLoading: loadingMsgs } = useEntityList('Message', messagesFilter, 'created_date', 500);

  const threadRef = useRef(null);

  // Auto-select the newest conversation on first load
  useEffect(() => {
    if (!selectedId && conversations.length > 0) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId]);

  // Auto-scroll to the latest message
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  async function newConversation() {
    const conv = await convMutation.mutateAsync({ action: 'create', data: { project_id: projectId, title: 'New Conversation' } });
    setSelectedId(conv.id);
    setInput('');
    setError(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('scheduleChat', {
        project_id: projectId,
        conversation_id: selectedId,
        user_message: text,
      });
      const data = res.data;
      if (data?.error) {
        setError(data.error);
        return;
      }
      setInput('');
      if (data?.conversation_id && data.conversation_id !== selectedId) {
        setSelectedId(data.conversation_id);
      }
      queryClient.invalidateQueries({ queryKey: ['Message'] });
      queryClient.invalidateQueries({ queryKey: ['Conversation'] });
    } catch (e) {
      setError(e?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const selectedConv = conversations.find((c) => c.id === selectedId);

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[70vh]">
      {/* Sidebar — conversations */}
      <div className="md:w-64 shrink-0 flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-100">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Conversations</span>
          <button
            onClick={newConversation}
            disabled={convMutation.isPending}
            className="flex items-center gap-1 px-2 py-1 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold rounded"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="p-4 text-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300 mx-auto" /></div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-xs text-slate-400 text-center">No conversations yet. Click “New” to start.</div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => { setSelectedId(c.id); setError(null); }}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition ${selectedId === c.id ? 'bg-amber-50 border-l-2 border-l-amber-400' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-sm font-medium text-slate-700 truncate">{c.title || 'Untitled'}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 ml-5">{formatDate(c.created_date)}</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat panel */}
      <div className="flex-1 flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <div className="font-semibold text-slate-700 text-sm">{selectedConv?.title || 'Schedule Assistant'}</div>
            <div className="text-[11px] text-slate-400">Scheduling & project controls expert</div>
          </div>
        </div>

        {/* Thread */}
        <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
          {!selectedId ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400">
              <Bot className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">Select a conversation or start a new one to ask about the schedule.</p>
            </div>
          ) : loadingMsgs ? (
            <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-300 mx-auto" /></div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400">
              <Lightbulb className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm max-w-sm">Ask anything — e.g. “Which tasks are on the critical path?” or “What’s at risk if engineering slips 5 days?”</p>
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Assistant is analyzing the schedule…
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-100 p-3">
          {error && <div className="text-xs text-red-600 mb-2 px-1">{error}</div>}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={selectedId ? 'Ask about the schedule…' : 'Start a new conversation to ask…'}
              disabled={sending}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none max-h-32 disabled:bg-slate-50"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const parsed = !isUser ? parseAssistant(message.content) : null;

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center ${isUser ? 'bg-slate-200' : 'bg-amber-100'}`}>
        {isUser ? <User className="w-4 h-4 text-slate-500" /> : <Bot className="w-4 h-4 text-amber-600" />}
      </div>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-2.5 text-sm ${isUser ? 'bg-slate-800 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'}`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : parsed ? (
            <p className="whitespace-pre-wrap">{parsed.answer}</p>
          ) : (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}
        </div>

        {/* Suggested actions + risk flags chips (assistant only) */}
        {parsed && (parsed.suggested_actions?.length > 0 || parsed.risk_flags?.length > 0) && (
          <div className="mt-2 space-y-1.5">
            {parsed.suggested_actions?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {parsed.suggested_actions.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1">
                    <Lightbulb className="w-3 h-3" /> {a}
                  </span>
                ))}
              </div>
            )}
            {parsed.risk_flags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {parsed.risk_flags.map((r, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-2.5 py-1">
                    <AlertTriangle className="w-3 h-3" /> {r}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}