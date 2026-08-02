import AssistantPanel from '@/components/project-detail/AssistantPanel';

// Schedule Assistant — kind-scoped to 'schedule', driven by the existing
// scheduleChat backend (proposed-changes flow untouched).
export default function TabAssistant({ projectId }) {
  return (
    <AssistantPanel
      projectId={projectId}
      kind="schedule"
      title="Schedule Assistant"
      subtitle="Scheduling & project controls expert"
      sendFunctionName="scheduleChat"
      placeholder="Ask anything — e.g. “Which tasks are on the critical path?” or “What’s at risk if engineering slips 5 days?”"
      emptyHint="Select a conversation or start a new one to ask about the schedule."
      accent={{
        ring: 'focus:ring-amber-400',
        sendBtn: 'bg-amber-500 hover:bg-amber-400',
        iconBg: 'bg-amber-50',
        iconText: 'text-amber-500',
        rowActive: 'bg-amber-50 border-l-2 border-l-amber-400',
      }}
    />
  );
}