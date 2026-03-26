import { notFound } from 'next/navigation';
import ProfileContent from './profile-content';

export default function ProfilePage() {
  if (process.env.AUTH_ENABLED !== 'true') {
    notFound();
  }
  return <ProfileContent />;
}
