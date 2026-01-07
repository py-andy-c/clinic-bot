import { http, HttpResponse } from 'msw';

// Mock authentication state
let currentUser = {
  id: 1,
  email: 'admin@example.com',
  full_name: 'Dr. Smith',
  roles: ['admin', 'practitioner'],
  active_clinic_id: 1,
  settings: {},
};

// Authentication handlers
export const authHandlers = [
  // Google OAuth login initiation
  http.get('/api/auth/google/login', ({ request }) => {
    const url = new URL(request.url);
    const userType = url.searchParams.get('user_type') || 'clinic_user';

    // Mock OAuth URL generation
    const mockOAuthUrl = `https://accounts.google.com/oauth/authorize?client_id=mock&redirect_uri=http://localhost:5174/auth/callback&scope=email%20profile&state=${userType}`;

    return HttpResponse.json({
      authorization_url: mockOAuthUrl,
      state: userType,
    });
  }),

  // Google OAuth callback
  http.get('/api/auth/google/callback', ({ request }) => {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    if (!code) {
      return HttpResponse.json(
        { error: 'Authorization code missing' },
        { status: 400 }
      );
    }

    // Mock successful OAuth callback
    return HttpResponse.json({
      access_token: 'mock_access_token_' + Date.now(),
      refresh_token: 'mock_refresh_token_' + Date.now(),
      token_type: 'Bearer',
      expires_in: 3600,
      user: {
        user_id: currentUser.id,
        email: currentUser.email,
        full_name: currentUser.full_name,
        roles: currentUser.roles,
        clinic_id: currentUser.active_clinic_id,
      },
    });
  }),

  // Logout
  http.post('/api/auth/logout', () => {
    // Mock successful logout
    return HttpResponse.json({
      message: 'Successfully logged out',
      success: true,
    });
  }),

  // Get available clinics
  http.get('/api/auth/clinics', () => {
    return HttpResponse.json([
      {
        id: 1,
        name: 'Main Clinic',
        display_name: 'Main Medical Center',
        role: 'admin',
      },
      {
        id: 2,
        name: 'Branch Clinic',
        display_name: 'Branch Medical Center',
        role: 'practitioner',
      },
    ]);
  }),

  // Switch clinic
  http.post('/api/auth/switch-clinic', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    if (!body.clinic_id) {
      return HttpResponse.json(
        { error: 'Clinic ID is required' },
        { status: 400 }
      );
    }

    // Update mock user clinic
    currentUser.active_clinic_id = body.clinic_id;

    return HttpResponse.json({
      success: true,
      message: 'Clinic switched successfully',
      user: {
        user_id: currentUser.id,
        email: currentUser.email,
        full_name: currentUser.full_name,
        roles: currentUser.roles,
        clinic_id: body.clinic_id,
      },
      clinic: {
        id: body.clinic_id,
        name: body.clinic_id === 1 ? 'Main Clinic' : 'Branch Clinic',
        display_name: body.clinic_id === 1 ? 'Main Medical Center' : 'Branch Medical Center',
      },
    });
  }),

  // Refresh user data
  http.post('/api/auth/refresh-user-data', () => {
    return HttpResponse.json({
      success: true,
      message: 'User data refreshed',
      user: {
        user_id: currentUser.id,
        email: currentUser.email,
        full_name: currentUser.full_name,
        roles: currentUser.roles,
        clinic_id: currentUser.active_clinic_id,
      },
    });
  }),

  // Clinic signup initiation
  http.post('/api/signup/clinic', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    // Validate required fields
    if (!body.clinic_name || !body.admin_email) {
      return HttpResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Mock OAuth URL for clinic signup
    const mockOAuthUrl = `https://accounts.google.com/oauth/authorize?client_id=mock&redirect_uri=http://localhost:5174/signup/callback&scope=email%20profile&state=clinic_signup`;

    return HttpResponse.json({
      authorization_url: mockOAuthUrl,
      state: 'clinic_signup',
      clinic_data: {
        name: body.clinic_name,
        email: body.admin_email,
      },
    });
  }),

  // Member signup initiation
  http.post('/api/signup/member', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    if (!body.email || !body.token) {
      return HttpResponse.json(
        { error: 'Email and token are required' },
        { status: 400 }
      );
    }

    // Mock OAuth URL for member signup
    const mockOAuthUrl = `https://accounts.google.com/oauth/authorize?client_id=mock&redirect_uri=http://localhost:5174/signup/callback&scope=email%20profile&state=member_signup_${body.token}`;

    return HttpResponse.json({
      authorization_url: mockOAuthUrl,
      state: `member_signup_${body.token}`,
      email: body.email,
    });
  }),

  // Confirm name after signup
  http.post('/api/signup/confirm-name', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    if (!body.token || !body.full_name) {
      return HttpResponse.json(
        { error: 'Token and full name are required' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      redirect_url: 'http://localhost:5174/admin',
      refresh_token: 'mock_refresh_token_' + Date.now(),
    });
  }),

  // Join clinic as existing user
  http.post('/api/signup/member/join-existing', async ({ request }) => {
    const body = await request.json() as Record<string, any>;

    if (!body.token) {
      return HttpResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      message: 'Successfully joined clinic',
      clinic: {
        id: 1,
        name: 'Main Clinic',
        display_name: 'Main Medical Center',
      },
      user: {
        user_id: currentUser.id,
        email: currentUser.email,
        full_name: body.name || currentUser.full_name,
        roles: currentUser.roles,
        clinic_id: 1,
      },
    });
  }),
];
