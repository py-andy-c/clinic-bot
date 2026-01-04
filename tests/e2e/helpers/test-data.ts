/**
 * Test data helpers for E2E tests.
 * 
 * Provides utilities for creating test data via API calls.
 * Uses unique identifiers to prevent conflicts in parallel test execution.
 */

import { APIRequestContext, Page } from '@playwright/test';

/**
 * Generate a unique identifier for test data.
 * Uses timestamp and random string to ensure uniqueness.
 */
export function generateUniqueId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Get access token from page's localStorage.
 * This is used to authenticate API requests in test helpers.
 * 
 * @param page - Playwright page object
 * @returns Access token or null if not found
 */
export async function getAccessTokenFromPage(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    return localStorage.getItem('auth_access_token');
  });
}

/**
 * Create a test patient via API.
 * 
 * @param request - Playwright API request context
 * @param options - Patient creation options
 * @param accessToken - Optional access token for authentication (required for authenticated endpoints)
 * @returns Created patient data
 */
export async function createTestPatient(
  request: APIRequestContext,
  options: {
    full_name?: string;
    phone_number?: string;
    birthday?: string; // ISO date string (YYYY-MM-DD)
    gender?: 'male' | 'female' | 'other';
  } = {},
  accessToken?: string
): Promise<{
  patient_id: number;
  full_name: string;
  phone_number?: string;
  birthday?: string;
  gender?: string;
  created_at: string;
}> {
  const uniqueId = generateUniqueId();
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8001';
  
  // Generate a valid phone number (Taiwan format: 09XX-XXXXXX)
  // Use only numeric characters from timestamp and random number
  const numericSuffix = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  const defaultPhoneNumber = `0912${numericSuffix}`;

  const patientData = {
    full_name: options.full_name || `Test Patient ${uniqueId}`,
    phone_number: options.phone_number || defaultPhoneNumber,
    ...(options.birthday && { birthday: options.birthday }),
    ...(options.gender && { gender: options.gender }),
  };

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await request.post(`${apiBaseUrl}/api/clinic/patients`, {
    data: patientData,
    headers,
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Failed to create test patient: ${response.status()} ${errorText}`);
  }

  return await response.json();
}

/**
 * Delete a test patient via API.
 * 
 * Note: There is no DELETE endpoint for patients in the clinic API.
 * This function is a no-op for now. Test data cleanup relies on unique identifiers
 * and database transactions/rollback for isolation.
 * 
 * @param request - Playwright API request context
 * @param patientId - Patient ID to delete (unused, kept for API compatibility)
 * @param accessToken - Optional access token for authentication (unused, kept for API compatibility)
 */
export async function deleteTestPatient(
  request: APIRequestContext,
  patientId: number,
  accessToken?: string
): Promise<void> {
  // Note: There is no DELETE endpoint for patients in /api/clinic/patients
  // The DELETE endpoint only exists in the LIFF API which requires LINE user authentication.
  // For E2E tests, we rely on:
  // 1. Unique identifiers to prevent conflicts
  // 2. Database transactions/rollback for isolation (when implemented)
  // 3. Test data cleanup via database operations (if needed in the future)
  
  // This is a no-op for now - cleanup happens via other mechanisms
  // Note: Patient deletion limitation is documented in function JSDoc above
}

/**
 * Get list of patients (for finding test patients to clean up).
 * 
 * @param request - Playwright API request context
 * @param search - Optional search query to filter patients
 * @param accessToken - Optional access token for authentication (required for authenticated endpoints)
 * @returns List of patients
 */
export async function listTestPatients(
  request: APIRequestContext,
  search?: string,
  accessToken?: string
): Promise<{
  patients: Array<{
    patient_id: number;
    full_name: string;
    phone_number?: string;
  }>;
  total: number;
}> {
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8001';
  
  const params = new URLSearchParams();
  if (search) {
    params.append('search', search);
  }

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await request.get(`${apiBaseUrl}/api/clinic/patients?${params.toString()}`, {
    headers,
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Failed to list patients: ${response.status()} ${errorText}`);
  }

  return await response.json();
}

/**
 * Clean up test patients matching a pattern.
 * Useful for cleaning up test data created with unique identifiers.
 * 
 * @param request - Playwright API request context
 * @param namePattern - Pattern to match patient names (e.g., "Test Patient test-")
 * @param accessToken - Optional access token for authentication (required for authenticated endpoints)
 */
export async function cleanupTestPatients(
  request: APIRequestContext,
  namePattern: string,
  accessToken?: string
): Promise<number> {
  const patients = await listTestPatients(request, namePattern, accessToken);
  let deletedCount = 0;

  for (const patient of patients.patients) {
    if (patient.full_name.includes(namePattern)) {
      try {
        await deleteTestPatient(request, patient.patient_id, accessToken);
        deletedCount++;
      } catch (error) {
        // Log but don't fail - some patients might already be deleted
        console.warn(`Failed to delete patient ${patient.patient_id}: ${error}`);
      }
    }
  }

  return deletedCount;
}

/**
 * Get appointment types for the current clinic.
 * 
 * @param request - Playwright API request context
 * @param accessToken - Optional access token for authentication (required for authenticated endpoints)
 * @returns List of appointment types
 */
export async function getAppointmentTypes(
  request: APIRequestContext,
  accessToken?: string
): Promise<Array<{
  id: number;
  name: string;
  duration_minutes: number;
}>> {
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8001';
  
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  
  // Appointment types are returned from the settings endpoint
  const response = await request.get(`${apiBaseUrl}/api/clinic/settings`, {
    headers,
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Failed to get appointment types: ${response.status()} ${errorText}`);
  }

  const data = await response.json();
  // Extract appointment_types from settings response
  return (data.appointment_types || []).map((at: { id: number; name: string; duration_minutes: number }) => ({
    id: at.id,
    name: at.name,
    duration_minutes: at.duration_minutes,
  }));
}

/**
 * Get practitioners for the current clinic.
 * 
 * @param request - Playwright API request context
 * @param accessToken - Optional access token for authentication (required for authenticated endpoints)
 * @returns List of practitioners
 */
export async function getPractitioners(
  request: APIRequestContext,
  accessToken?: string
): Promise<Array<{
  id: number;
  full_name: string;
  email: string;
}>> {
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8001';
  
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  
  const response = await request.get(`${apiBaseUrl}/api/clinic/members`, {
    headers,
  });

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(`Failed to get practitioners: ${response.status()} ${errorText}`);
  }

  const data = await response.json();
  return (data.members || []).filter((m: { roles?: string[] }) => 
    m.roles?.includes('practitioner')
  );
}

