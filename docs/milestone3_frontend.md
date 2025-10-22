# Milestone 3 Frontend Implementation Plan

## Overview

Milestone 3 introduces a complete authentication and user management system with three distinct user roles: System Admins, Clinic Admins, and Practitioners. The frontend needs significant updates to support role-based access control, new signup flows, and updated user management interfaces.

## Current Frontend State

### Existing Structure
- **Authentication**: Basic Google OAuth login with single user type
- **Pages**: Dashboard, Therapists, Patients, Settings
- **Provider App**: Separate clinic onboarding interface
- **API Service**: Admin endpoints with Therapist model
- **Types**: Separate Therapist/Patient models

### Legacy Code to Remove
- Provider app (`ProviderApp.tsx`, `ProviderLayout.tsx`, provider pages)
- Therapist-specific interfaces (rename to "Members")
- Old admin API endpoints (`/admin/*`)
- Separate user type handling

## Required Frontend Changes

### 1. Authentication & Routing Updates

#### New User Types & Roles
```typescript
interface User {
  id: string;
  email: string;
  name: string;
  roles: string[]; // ['admin', 'practitioner']
  clinic_id?: number;
  user_type: 'system_admin' | 'clinic_user';
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
```

#### Role-Based Routing
- **System Admin**: `/system/dashboard`, `/system/clinics`
- **Clinic Users**: `/clinic/dashboard`, `/clinic/members`, `/clinic/patients`, `/clinic/settings`

#### Updated App.tsx
```typescript
const AppRoutes: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) return <LoadingSpinner />;

  if (!isAuthenticated) return <LoginPage />;

  // Role-based routing
  if (user?.user_type === 'system_admin') {
    return (
      <SystemAdminLayout>
        <Routes>
          <Route path="/system/dashboard" element={<SystemDashboardPage />} />
          <Route path="/system/clinics" element={<SystemClinicsPage />} />
          <Route path="/system/clinics/:id" element={<SystemClinicDetailPage />} />
        </Routes>
      </SystemAdminLayout>
    );
  }

  // Clinic users
  return (
    <ClinicLayout>
      <Routes>
        <Route path="/clinic/dashboard" element={<ClinicDashboardPage />} />
        <Route path="/clinic/members" element={<MembersPage />} />
        <Route path="/clinic/patients" element={<PatientsPage />} />
        <Route path="/clinic/settings" element={<SettingsPage />} />
      </Routes>
    </ClinicLayout>
  );
};
```

### 2. New Pages & Components

#### System Admin Pages
- `SystemDashboardPage.tsx` - Platform metrics, clinic overview
- `SystemClinicsPage.tsx` - List/create clinics, health monitoring
- `SystemClinicDetailPage.tsx` - Clinic details, settings, health checks

#### Public Signup Pages
- `ClinicSignupPage.tsx` - Token-based clinic admin signup
- `MemberSignupPage.tsx` - Token-based team member signup

#### Updated Existing Pages
- `MembersPage.tsx` (renamed from TherapistsPage) - Role management
- `ClinicDashboardPage.tsx` (updated from DashboardPage) - Clinic-specific metrics

#### New Components
- `SystemAdminLayout.tsx` - System admin navigation
- `ClinicLayout.tsx` - Clinic user navigation
- `MemberInviteModal.tsx` - Role selection for invitations
- `RoleManagementModal.tsx` - Update member roles
- `ClinicHealthStatus.tsx` - LINE integration health display

### 3. API Service Updates

#### New API Endpoints
```typescript
class ApiService {
  // Authentication
  async initiateGoogleAuth(userType?: 'system_admin' | 'clinic_user'): Promise<{ auth_url: string }> {
    return this.get(`/auth/google/login${userType ? `?user_type=${userType}` : ''}`);
  }

  // System Admin APIs
  async getSystemDashboard(): Promise<SystemDashboardData> {
    return this.get('/system/dashboard');
  }

  async getClinics(): Promise<Clinic[]> {
    return this.get('/system/clinics');
  }

  async createClinic(clinicData: ClinicCreateData): Promise<Clinic> {
    return this.post('/system/clinics', clinicData);
  }

  async getClinicHealth(clinicId: number): Promise<ClinicHealth> {
    return this.get(`/system/clinics/${clinicId}/health`);
  }

  // Clinic APIs
  async getMembers(): Promise<Member[]> {
    return this.get('/clinic/members');
  }

  async inviteMember(email: string, name: string, roles: string[]): Promise<{ signup_url: string }> {
    return this.post('/clinic/members/invite', { email, name, roles });
  }

  async updateMemberRoles(userId: number, roles: string[]): Promise<void> {
    return this.put(`/clinic/members/${userId}/roles`, { roles });
  }

  async removeMember(userId: number): Promise<void> {
    return this.delete(`/clinic/members/${userId}`);
  }

  async initiateMemberGcalAuth(userId: number): Promise<{ auth_url: string }> {
    return this.get(`/clinic/members/${userId}/gcal/auth`);
  }

  // Signup APIs (public)
  async validateSignupToken(token: string, type: 'clinic' | 'member'): Promise<SignupTokenInfo> {
    return this.get(`/signup/${type}?token=${token}`);
  }
}
```

### 4. Updated Types

#### New Type Definitions
```typescript
// User roles and types
type UserRole = 'admin' | 'practitioner';
type UserType = 'system_admin' | 'clinic_user';

interface User {
  id: number;
  email: string;
  full_name: string;
  roles: UserRole[];
  clinic_id?: number;
  user_type: UserType;
  gcal_sync_enabled?: boolean;
  created_at: string;
  updated_at: string;
}

// Replace Therapist with Member
interface Member extends User {
  // Inherits all User properties
}

// System admin types
interface SystemDashboardData {
  total_clinics: number;
  active_clinics: number;
  total_users: number;
  system_health: 'healthy' | 'warning' | 'error';
}

interface ClinicHealth {
  clinic_id: number;
  line_integration_status: 'healthy' | 'warning' | 'error';
  webhook_status: 'active' | 'inactive';
  webhook_count_24h: number;
  signature_verification_capable: boolean;
  api_connectivity: string;
  error_messages: string[];
  health_check_performed_at: string;
}

// Signup types
interface SignupTokenInfo {
  token: string;
  clinic_name?: string;
  default_roles?: UserRole[];
  expires_at: string;
  is_expired: boolean;
  is_used: boolean;
}
```

### 5. Authentication Hook Updates

#### Enhanced useAuth Hook
```typescript
interface AuthContextType extends AuthState {
  login: (userType?: 'system_admin' | 'clinic_user') => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  hasRole: (role: UserRole) => boolean;
  isSystemAdmin: boolean;
  isClinicAdmin: boolean;
  isPractitioner: boolean;
}
```

#### Updated Implementation
```typescript
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Enhanced user object with role helpers
  const enhancedUser = useMemo(() => {
    if (!authState.user) return null;
    return {
      ...authState.user,
      hasRole: (role: UserRole) => authState.user?.roles?.includes(role) ?? false,
      isSystemAdmin: authState.user?.user_type === 'system_admin',
      isClinicAdmin: authState.user?.user_type === 'clinic_user' && authState.user?.roles?.includes('admin'),
      isPractitioner: authState.user?.user_type === 'clinic_user' && authState.user?.roles?.includes('practitioner'),
    };
  }, [authState.user]);

  // ... rest of implementation
};
```

### 6. Signup Flow Implementation

#### Public Signup Routes
```typescript
// In App.tsx (public routes, no auth required)
<Route path="/signup/clinic" element={<ClinicSignupPage />} />
<Route path="/signup/member" element={<MemberSignupPage />} />
```

#### Signup Pages
- Token validation from URL parameters
- Google OAuth integration for signup completion
- Automatic role assignment based on token
- Redirect to appropriate dashboard after signup

### 7. Layout Components

#### SystemAdminLayout
- Navigation: Dashboard, Clinics, Settings
- Header with system admin info
- Breadcrumb navigation

#### ClinicLayout
- Navigation: Dashboard, Members, Patients, Settings
- Header with clinic info and user roles
- Role-based menu item visibility

### 8. Form Components & Modals

#### Member Management
- `InviteMemberForm`: Email, name, role checkboxes (admin/practitioner)
- `EditMemberRolesModal`: Update existing member roles
- `ConfirmRemoveMemberModal`: Soft delete confirmation

#### Clinic Management (System Admin)
- `CreateClinicForm`: Clinic details, LINE credentials
- `ClinicHealthModal`: Detailed health diagnostics
- `GenerateSignupLinkModal`: Create clinic admin invitation

### 9. Testing Strategy

#### Unit Tests
- Updated auth hook tests for role-based logic
- API service tests for new endpoints
- Component tests for role-based rendering

#### Integration Tests
- Complete signup flows (clinic admin + member)
- Role-based access control
- Member invitation and role management
- System admin clinic management

### 10. Migration Plan

#### Phase 1: Core Infrastructure
1. Update authentication system with JWT tokens
2. Implement role-based routing
3. Create basic layouts and navigation

#### Phase 2: System Admin Features
1. System admin dashboard and clinic management
2. Clinic creation and health monitoring
3. LINE integration status displays

#### Phase 3: Clinic Admin Features
1. Member management (rename from therapists)
2. Role assignment and invitation system
3. Updated clinic dashboard

#### Phase 4: Signup Flows
1. Public signup pages
2. Token validation and OAuth completion
3. Automatic role assignment and routing

#### Phase 5: Cleanup & Polish
1. Remove legacy provider app
2. Update all references from "therapists" to "members"
3. Comprehensive testing and documentation

## Implementation Priority

1. **High Priority**: Authentication system updates, role-based routing
2. **High Priority**: System admin dashboard and clinic management
3. **Medium Priority**: Member management and invitation system
4. **Medium Priority**: Signup flows and public pages
5. **Low Priority**: UI polish, additional testing, documentation updates

## Quality Assurance

- **TypeScript**: 100% type coverage for all new components
- **Testing**: Unit tests for all hooks/utilities, integration tests for key flows
- **Accessibility**: ARIA labels, keyboard navigation, screen reader support
- **Responsive**: Mobile-first design for clinic tablet usage
- **Performance**: Lazy loading, optimized re-renders, efficient API calls

## Legacy Code Removal Checklist

- [ ] Remove `ProviderApp.tsx` and provider pages
- [ ] Remove `ProviderLayout.tsx` and provider components
- [ ] Update `TherapistsPage.tsx` → `MembersPage.tsx`
- [ ] Remove therapist-specific types and interfaces
- [ ] Update API service endpoints
- [ ] Remove provider-specific API calls
- [ ] Update routing configuration
- [ ] Clean up unused CSS classes and styles
