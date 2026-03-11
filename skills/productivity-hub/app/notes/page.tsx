import { Suspense } from 'react';
import NotesContent from './NotesContent';

export default function NotesPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <NotesContent />
    </Suspense>
  );
}
