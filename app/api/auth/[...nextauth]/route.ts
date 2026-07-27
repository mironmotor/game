import { handlers } from '@/lib/auth';
import { appBasePath } from '@/lib/base-path';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

// Next strips its basePath before invoking a Route Handler. Put it back for
// local /game builds so Auth.js parses the same path it uses to build URLs.
function withAuthBasePath(handler: (req: NextRequest) => Promise<Response>) {
  return (req: NextRequest): Promise<Response> => {
    const url = req.nextUrl.clone();
    if (appBasePath && !url.pathname.startsWith(`${appBasePath}/`)) {
      url.pathname = `${appBasePath}${url.pathname}`;
      return handler(new NextRequest(url, req));
    }
    return handler(req);
  };
}

export const GET = withAuthBasePath(handlers.GET);
export const POST = withAuthBasePath(handlers.POST);
