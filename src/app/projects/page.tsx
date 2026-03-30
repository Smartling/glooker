import { notFound } from 'next/navigation';
import ProjectsContent from './projects-content';

export const dynamic = 'force-dynamic';

export default function ProjectsPage() {
  if (process.env.JIRA_ENABLED !== 'true') {
    notFound();
  }
  if (!process.env.JIRA_PROJECTS_JQL) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-gray-500">
        <h1 className="text-xl font-semibold text-white mb-2">Projects</h1>
        <p>JIRA_PROJECTS_JQL is not configured. Set this environment variable to enable the projects view.</p>
      </div>
    );
  }
  return <ProjectsContent />;
}
