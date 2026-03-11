import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const start = Date.now();
  const response = NextResponse.next();

  // Log after response is prepared (synchronous timing, not full round-trip)
  const duration = Date.now() - start;
  const method = request.method;
  const path = request.nextUrl.pathname;
  console.log(`${method} ${path} (${duration}ms)`);

  return response;
}

export const config = {
  // Match API routes and pages, skip static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
