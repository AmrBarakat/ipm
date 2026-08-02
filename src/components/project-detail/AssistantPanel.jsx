import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { formatDate } from '@/lib/constants';
import { toast } from 'sonner';
import { Plus, Send, Loader2, Bot, User, AlertTriangle, Lightbulb, MessageSquare, Trash2 } from 'lucide-react';
import ScheduleProposedChanges from '@/components/project-detail/ScheduleProposedChanges';

function parseAssistant(content) {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj.answer === 'string') return obj;
  } catch (_) { /* not json */ }
  return null;
}

/**
 * Shared assistant shell. Drives a kind-scoped conversation list, a chat thread,
 * and a composer that invokes `sendFunctionName`. Per-conversation delete and a
 * kind-scoped "Clear all" keep each assistant's history isolated.
 *
 * The schedule proposed-changes flow is unchanged: assistant messages that carry
 * `proposed_changes` still render ScheduleProposedChanges — the project assistant
 * simply never produces them, so nothing extra is needed.
 */
export default function AssistantPanel({
  projectId,
  kind, // 'schedule' | 'project'
  title,
  subtitle,
  accent, // { ring, sendBtn, iconBg, iconText, rowActive, avatar, avatarText }
  sendFunctionName,
  placeholder,
  emptyHint,
}) {
  const queryClient = useQueryClient();
  const { data: allConvs = [], isLoading: loadingConvs } = useEntityList('Conversation', { project_id: projectId }, '-created_date', 200);
  const convMutation = useEntityMutation('Conversation');
  const confirmDialog = useConfirm();

  // Kind isolation: schedule shows kind==='schedule'; project shows everything
  // else (incl. legacy conversations with no kind), so histories never mix.
  const conversations = (allConvs || []).filter((c) => (kind === 'schedule' ? c.kind === 'schedule' : c.kind !== 'schedule'));

  const [selectedId, setSelectedId] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [clearing, setClearing] = useState(false);

  const messagesFilter = { conversation_id: selectedId || '__none__' };
  const { data: messages = [], isLoading: loadingMsgs } = useEntityList('Message', messagesFilter, 'created_date', 500);

  const threadRef = useRef(null);

  useEffect(() => {
    if (!selectedId && conversations.length > 0) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  async function newConversation() {
    const conv = await convMutation.mutateAsync({ action: 'create', data: { project_id: projectId, kind, title: 'New Conversation' } });
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
      const res = await base44.functions.invoke(sendFunctionName, { project_id: projectId, conversation_id: selectedId, user_message: text });
      const data = res.data;
      if (data?.error) { setError(data.error); return; }
      setInput('');
      if (data?.conversation_id && data.conversation_id !== selectedId) setSelectedId(data.conversation_id);
      queryClient.invalidateQueries({ queryKey: ['Message'] });
      queryClient.invalidateQueries({ queryKey: ['Conversation'] });
    } catch (e) {
      setError(e?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function deleteConversation(c) {
    if (!(await confirmDialog({ title: 'Delete this conversation and all its messages?', description: c.title || 'Untitled', confirmText: 'Delete', destructive: true }))) return;
    try {
      await base44.entities.Message.deleteMany({ conversation_id: c.id });
      await base44.entities.Conversation.delete(c.id);
      if (selectedId === c.id) setSelectedId(null);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['Conversation'] }), queryClient.invalidateQueries({ queryKey: ['Message'] })]);
      toast.success('Conversation deleted');
    } catch (e) {
      toast.error(e?.message || 'Failed to delete conversation');
    }
  }

  async function clearAll() {
    if (!conversations.length) return;
    if (!(await confirmDialog({ title: `Delete all ${conversations.length} ${kind} conversation(s)?`, description: 'This permanently removes every conversation and message shown in this assistant.', confirmText: 'Delete all', destructive: true }))) return;
    setClearing(true);
    try {
      await Promise.all(conversations.map((c) =>
        base44.entities.Message.deleteMany({ conversation_id: c.id }).then(() => base44.entities.Conversation.delete(c.id)),
      ));
      setSelectedId(null);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['Conversation'] }), queryClient.invalidateQueries({ queryKey: ['Message'] })]);
      toast.success('All conversations cleared');
    } catch (e) {
      toast.error(e?.message || 'Failed to clear conversations');
    } finally {
      setClearing(false);
    }
  }

  const selectedConv = conversations.find((c) => c.id === selectedId);

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[70vh]">
      {/* Sidebar — conversations */}
      <div className="md:w-64 shrink-0 flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-100">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Conversations</span>
          <div className="flex items-center gap-1">
            {conversations.length > 0 && (
              <button onClick={clearAll} disabled={clearing} title="Clear all"
                className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={newConversation} disabled={convMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold rounded disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="p-4 text-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300 mx-auto" /></div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-xs text-slate-400 text-center">No conversations yet. Click “New” to start.</div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => { setSelectedId(c.id); setError(null); }}
                className={`group relative w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition cursor-pointer ${selectedId === c.id ? accent.rowActive : ''}`}
              >
                <div className="flex items-center gap-2 pr-6">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-sm font-medium text-slate-700 truncate">{c.title || 'Untitled'}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 ml-5">{formatDate(c.created_date)}</div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(c); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-300 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition"
                  title="Delete conversation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat panel */}
      <div className="flex-1 flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <div className={`w-8 h-8 ${accent.iconBg} rounded-lg flex items-center justify-center`}>
            <Bot className={`w-4 h-4 ${accent.iconText}`} />
          </div>
          <div>
            <div className="font-semibold text-slate-700 text-sm">{selectedConv?.title || title}</div>
            <div className="text-[11px] text-slate-400">{subtitle}</div>
          </div>
        </div>

        <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
          {!selectedId ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400">
              <Bot className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">{emptyHint}</p>
            </div>
          ) : loadingMsgs ? (
            <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-300 mx-auto" /></div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400">
              <Lightbulb className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm max-w-sm">{placeholder}</p>
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} projectId={projectId} />)
          )}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Assistant is thinking…
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 p-3">
          {error && <div className="text-xs text-red-600 mb-2 px-1">{error}</div>}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={selectedId ? 'Ask a question…' : 'Start a new conversation to ask…'}
              disabled={sending}
              className={`flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${accent.ring} resize-none max-h-32 disabled:bg-slate-50`}
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className={`flex items-center gap-1.5 px-4 py-2 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${accent.sendBtn}`}
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

function MessageBubble({ message, projectId }) {
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

        {/* Proposed schedule changes — review + apply (schedule assistant only) */}
        {parsed && parsed.proposed_changes?.length > 0 && (
          <ScheduleProposedChanges
            proposedChanges={parsed.proposed_changes}
            impact={parsed.impact}
            conflictsFound={parsed.conflicts_found}
            conflictsResolved={parsed.conflicts_resolved}
            rejected={parsed.rejected}
            projectId={projectId}
          />
        )}

        {/* Suggested actions + risk flags chips (any assistant) */}
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