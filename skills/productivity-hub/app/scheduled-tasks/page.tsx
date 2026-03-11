import { Suspense } from 'react';
import ScheduledTasksContent from './ScheduledTasksContent';

export default function ScheduledTasksPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ScheduledTasksContent />
    </Suspense>
  );
}
