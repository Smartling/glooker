import { notFound } from 'next/navigation';
import ProfileContent from './profile-content';
import ChatPanelAuto from '@/app/chat-panel-auto';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  if (process.env.AUTH_ENABLED !== 'true') {
    notFound();
  }
  return (
    <>
      <ProfileContent />
      <ChatPanelAuto />
    </>
  );
}
