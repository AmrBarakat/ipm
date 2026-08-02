import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { formatDate } from '@/lib/constants';
import { toast } from 'sonner';
import {
  Plus, Send, Loader2, Bot, User, MessageSquare, Trash2,
  ChevronDown, AlertTriangle, ArrowRight, FolderOpen,
} from 'lucide-react';

const STARTERS = [
  "What's our margin on this project?",
  "Which BOM items are overdue for delivery?",
  "Summarize open risks",
  "How much have we collected vs invoiced?",
  "What's the schedule status?",
  "List open purchase orders",
];

// markdown-lite: preserve line breaks + **bold**.
function renderRich(text) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <span key={i}>{p}</span>;
  });
}

function parseAssistant(content) {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj.answer === 'string') return obj;
  } catch (_) { /* legacy plain text */ }
  return null;
}

export default function TabProjectAssistant({ projectId, onNavigateTab }) {
  const queryClient = useQueryClient();
  const { data: conversations = [], isLoading: loadingConvs } = useEntityList(
    'Conversation',
    { project_id: projectId, kind: 'project' },
    '-created_date',
    200,
  );
  const convMutation = useEntityMutation('Conversation');
  const confirmDialog = useConfirm();

  const [selectedId, setSelectedId] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [clearing, setClearing] = useState(false);

  const { data: messages = [], isLoading: loadingMsgs } = useEntityList(
    'Message',
    { conversation_id: selectedId || '__none__' },
    'created_date',
    500,
  );

  const threadRef = useRef(null);

  useEffect(() => {
    if (!selectedId && conversations.length > 0) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, sending]);

  async function newConversation() {
    const conv = await convMutation.mutateAsync({
      action: 'create',
      data: { project_id: projectId, kind: 'project', title: 'New Conversation' },
    });
    setSelectedId(conv.id);
    setInput('');
    setError(null);
  }

  async function send(textArg, convIdArg) {
    const text = (textArg ?? input).trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('projectChat', {
        project_id: projectId,
        conversation_id: convIdArg ?? selectedId,
        user_message: text,
      });
      const data = res.data;
      if (data?.error) { setError(data.error); return; }
      setInput('');
      if (data?.conversation_id && data.conversation_id !== selectedId) setSelectedId(data.conversation_id);
      queryClient.invalidateQueries({ queryKey: ['Message'] });
      queryClient.invalidateQueries({ queryKey: ['Conversation'] });
    } catch (e) {
      const serverMsg = e?.response?.data?.error || e?.response?.data?.message || e?.data?.error;
      setError(serverMsg ? `Assistant error: ${serverMsg}` : (e?.message || 'Failed to send message'));
      console.error('projectChat failed:', e?.response?.data || e);
    } finally {
      setSending(false);
    }
  }

  async function askStarter(text) {
    if (sending) return;
    let cid = selectedId;
    if (!cid) {
      const conv = await convMutation.mutateAsync({
        action: 'create',
        data: { project_id: projectId, kind: 'project', title: text.slice(0, 60) },
      });
      cid = conv.id;
      setSelectedId(cid);
    }
    await send(text, cid);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function deleteConversation(c) {
    if (!(await confirmDialog({
      title: 'Delete this conversation and all its messages?',
      description: c.title || 'Untitled', confirmText: 'Delete', destructive: true,
    }))) return;
    try {
      await base44.entities.Message.deleteMany({ conversation_id: c.id });
      await base44.entities.Conversation.delete(c.id);
      if (selectedId === c.id) setSelectedId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['Conversation'] }),
        queryClient.invalidateQueries({ queryKey: ['Message'] }),
      ]);
      toast.success('Conversation deleted');
    } catch (e) {
      const serverMsg = e?.response?.data?.error || e?.response?.data?.message || e?.data?.error;
      toast.error(serverMsg || e?.message || 'Failed to delete conversation');
      console.error('delete conversation failed:', e?.response?.data || e);
    }
  }

  async function clearAll() {
    if (!conversations.length) return;
    if (!(await confirmDialog({
      title: `Delete all ${conversations.length} project conversation(s)?`,
      description: 'This permanently removes every conversation and message shown in this assistant.',
      confirmText: 'Delete all', destructive: true,
    }))) return;
    setClearing(true);
    try {
      await Promise.all(conversations.map((c) =>
        base44.entities.Message.deleteMany({ conversation_id: c.id }).then(() => base44.entities.Conversation.delete(c.id)),
      ));
      setSelectedId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['Conversation'] }),
        queryClient.invalidateQueries({ queryKey: ['Message'] }),
      ]);
      toast.success('All conversations cleared');
    } catch (e) {
      const serverMsg = e?.response?.data?.error || e?.response?.data?.message || e?.data?.error;
      toast.error(serverMsg || e?.message || 'Failed to clear conversations');
      console.error('clear conversations failed:', e?.response?.data || e);
    } finally {
      setClearing(false);
    }
  }

  const selectedConv = conversations.find((c) => c.id === selectedId);

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[70vh]">
      {/* Conversation list */}
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
              className="flex items-center gap-1 px-2 py-1 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold rounded disabled:opacity-50">
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
                className={`group relative w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition cursor-pointer ${selectedId === c.id ? 'bg-indigo-50 border-l-2 border-l-indigo-400' : ''}`}
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
          <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
            <Bot className="w-4 h-4 text-indigo-500" />
          </div>
          <div>
            <div className="font-semibold text-slate-700 text-sm">{selectedConv?.title || 'Project Assistant'}</div>
            <div className="text-[11px] text-slate-400">General project expert — BOM, finance, procurement, schedule & more</div>
          </div>
        </div>

        <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
          {!selectedId ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400">
              <FolderOpen className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm mb-4 max-w-sm">Ask anything about this project. Try one of these:</p>
              <div className="flex flex-col gap-2 w-full max-w-md">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => askStarter(s)}
                    disabled={sending}
                    className="text-left px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/50 text-slate-600 hover:text-indigo-700 transition disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : loadingMsgs ? (
            <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-300 mx-auto" /></div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400">
              <Bot className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm max-w-sm">Ask anything about this project — BOM, finance, procurement, schedule…</p>
            </div>
          ) : (
            messages.map((m) => <ProjectMessageBubble key={m.id} message={m} onNavigateTab={onNavigateTab} />)
          )}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Assistant is reviewing the project…
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
              placeholder="Ask anything about this project — BOM, finance, procurement, schedule…"
              disabled={sending}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none max-h-32 disabled:bg-slate-50"
            />
            <button
              onClick={() => send()}
              disabled={sending || !input.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
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

function ProjectMessageBubble({ message, onNavigateTab }) {
  const isUser = message.role === 'user';
  const parsed = !isUser ? parseAssistant(message.content) : null;

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center ${isUser ? 'bg-slate-200' : 'bg-indigo-100'}`}>
        {isUser ? <User className="w-4 h-4 text-slate-500" /> : <Bot className="w-4 h-4 text-indigo-600" />}
      </div>
      <div className={`max-w-[82%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1.5`}>
        <div className={`rounded-2xl px-4 py-2.5 text-sm ${isUser ? 'bg-slate-800 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'}`}>
          <div className="whitespace-pre-wrap leading-relaxed">
            {isUser ? message.content : parsed ? renderRich(parsed.answer) : message.content}
          </div>
        </div>

        {parsed && (
          <>
            {/* Sources — collapsed under a "Based on" line */}
            {parsed.citations?.length > 0 && (
              <details className="text-xs w-full">
                <summary className="cursor-pointer text-slate-400 hover:text-slate-600 select-none">
                  Based on: {(parsed.citations || []).map((c) => c.area).filter(Boolean).join(' · ')}
                  <ChevronDown className="w-3 h-3 inline ml-1" />
                </summary>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {parsed.citations.map((c, i) => (
                    <span key={i} className="inline-flex items-center text-[11px] bg-slate-100 text-slate-600 border border-slate-200 rounded-full px-2 py-0.5">
                      <span className="font-semibold text-slate-700">{c.area}</span>{c.detail ? `: ${c.detail}` : ''}
                    </span>
                  ))}
                </div>
              </details>
            )}

            {/* Suggested actions → navigate to the named project tab */}
            {parsed.suggested_actions?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {parsed.suggested_actions.map((a, i) => (
                  <button
                    key={i}
                    onClick={() => onNavigateTab?.(a.tab)}
                    className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2.5 py-1 hover:bg-indigo-100 transition"
                  >
                    {a.label} <ArrowRight className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}

            {/* Data gaps */}
            {parsed.data_gaps?.length > 0 && (
              <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                <span>Couldn't find: {parsed.data_gaps.join(', ')}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}