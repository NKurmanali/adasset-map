import Workspace from '@/components/workspace';
import { headers } from 'next/headers';
import { localPasswordlessAllowed } from '@/lib/local-access';
export default async function Page() {
  return <Workspace allowLocalLogin={localPasswordlessAllowed(await headers())} />;
}
