import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Tiny status probe so the login button knows whether Google OAuth credentials
// are configured — avoids sending the user into NextAuth's raw "Server error"
// page when the database or OAuth secrets aren't set yet.
export async function GET() {
  return NextResponse.json({
    // База не обязательна: без DATABASE_URL вход работает на JWT-сессиях.
    googleReady: Boolean(
      process.env.AUTH_SECRET?.trim() &&
        process.env.AUTH_GOOGLE_ID?.trim() &&
        process.env.AUTH_GOOGLE_SECRET?.trim(),
    ),
  });
}
