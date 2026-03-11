import { Suspense } from 'react';
import TodosContent from './TodosContent';

export default function TodosPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TodosContent />
    </Suspense>
  );
}
