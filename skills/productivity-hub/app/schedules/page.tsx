import { Suspense } from 'react';
import SchedulesContent from './SchedulesContent';

export default function SchedulesPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SchedulesContent />
    </Suspense>
  );
}
