import AssistantPanel from '@/components/project-detail/AssistantPanel';

// General Project Assistant — kind-scoped to 'project', driven by the
// projectChat backend. Separate conversation history from the Schedule Assistant.
export default function TabProjectAssistant({ projectId }) {
  return (
    <AssistantPanel
      projectId={projectId}
      kind="project"
      title="Project Assistant"
      subtitle="General project expert — cost, scope, procurement & more"
      sendFunctionName="projectChat"
      placeholder="Ask anything — e.g. “What’s our biggest cost overrun?” or “Summarize open risks and who owns them.”"
      emptyHint="Select a conversation or start a new one to ask about the project."
      accent={{
        ring: 'focus:ring-indigo-400',
        sendBtn: 'bg-indigo-500 hover:bg-indigo-400',
        iconBg: 'bg-indigo-50',
        iconText: 'text-indigo-500',
        rowActive: 'bg-indigo-50 border-l-2 border-l-indigo-400',
      }}
    />
  );
}