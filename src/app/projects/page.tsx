import { notFound } from 'next/navigation';
import ProjectsContent from './projects-content';
import ChatPanelAuto from '@/app/chat-panel-auto';

export const dynamic = 'force-dynamic';

export default function ProjectsPage() {
  if (process.env.JIRA_ENABLED !== 'true') {
    notFound();
  }
  // No env-var gate beyond JIRA_ENABLED: boards are configured from
  // Settings → Projects (the jira_projects table), not an env var. When
  // nothing is configured yet, GET /api/projects owns that state and
  // ProjectsContent renders its "No Jira projects configured. Add one in
  // Settings → Projects." message.
  return (
    <>
      <ProjectsContent />
      <ChatPanelAuto />
    </>
  );
}
