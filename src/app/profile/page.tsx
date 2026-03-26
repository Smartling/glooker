import { notFound } from 'next/navigation';
import ProfileContent from './profile-content';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  if (process.env.AUTH_ENABLED !== 'true') {
    notFound();
  }
  return <ProfileContent />;
}
