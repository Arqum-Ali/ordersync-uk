
import { NextResponse } from 'next/server';

export async function GET() {
  const appKey = process.env.ALIEXPRESS_APP_KEY;
  const redirectUri = process.env.ALIEXPRESS_REDIRECT_URI;
  const state = process.env.ALIEXPRESS_OAUTH_STATE;

  if (!appKey || !redirectUri || !state) {
    return NextResponse.json(
      {
        success: false,
        message: 'AliExpress environment variables missing'
      },
      { status: 500 }
    );
  }

  const authUrl = new URL(
    'https://api-sg.aliexpress.com/oauth/authorize'
  );

  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('force_auth', 'true');
  authUrl.searchParams.set('client_id', appKey);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl);
}
