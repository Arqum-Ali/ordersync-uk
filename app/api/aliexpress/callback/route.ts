import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // AliExpress may return an authorization code.
    const code =
      searchParams.get('code') ||
      searchParams.get('auth_code');

    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          message: 'AliExpress authorization failed.',
          error
        },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        {
          ok: false,
          message: 'Authorization code was not received.',
          receivedParameters: Array.from(searchParams.keys())
        },
        { status: 400 }
      );
    }

    // Temporarily store the authorization code securely.
    // The next step will exchange it for an access token.
    const response = NextResponse.json({
      ok: true,
      message: 'AliExpress authorization callback received successfully.',
      stateReceived: Boolean(state)
    });

    response.cookies.set('ae_auth_code', code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/aliexpress',
      maxAge: 300
    });

    return response;

  } catch (error) {
    console.error('AliExpress callback error:', error);

    return NextResponse.json(
      {
        ok: false,
        message: 'Internal callback error.'
      },
      { status: 500 }
    );
  }
}
