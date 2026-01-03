/**
 * Test Data Factory
 * 
 * Provides helper functions to create test data programmatically for E2E tests.
 * Uses test-only API endpoints for fast, direct data creation.
 */

import { Page } from '@playwright/test';

export interface Clinic {
  id: number;
  name: string;
  display_name: string;
}

export interface User {
  id: number;
  email: string;
}

export interface UserClinicAssociation {
  id: number;
  user_id: number;
  clinic_id: number;
  roles: string[];
  full_name: string;
  is_active: boolean;
}

export class TestDataFactory {
  /**
   * Get the API base URL for test endpoints
   */
  private static getApiBaseUrl(page: Page): string {
    const baseURL = page.context().baseURL || 'http://localhost:3000';
    const baseUrlObj = new URL(baseURL);
    const backendPort = process.env.E2E_BACKEND_PORT || '8000';
    return `${baseUrlObj.protocol}//${baseUrlObj.hostname}:${backendPort}/api`;
  }

  /**
   * Create a test clinic
   */
  static async createClinic(
    page: Page,
    name: string = `Test Clinic ${Date.now()}`
  ): Promise<Clinic> {
    const apiBaseUrl = this.getApiBaseUrl(page);
    // Generate unique channel IDs to avoid unique constraint violations
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const response = await page.request.post(`${apiBaseUrl}/test/clinics`, {
      data: {
        name,
        line_channel_id: `test_channel_${timestamp}_${randomSuffix}`,
        line_channel_secret: `test_secret_${timestamp}_${randomSuffix}`,
        line_channel_access_token: `test_token_${timestamp}_${randomSuffix}`,
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`Failed to create clinic: ${response.status()} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Create a test user
   */
  static async createUser(
    page: Page,
    email: string,
    googleSubjectId?: string
  ): Promise<User> {
    const apiBaseUrl = this.getApiBaseUrl(page);
    const response = await page.request.post(`${apiBaseUrl}/test/users`, {
      data: {
        email,
        google_subject_id: googleSubjectId,
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`Failed to create user: ${response.status()} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Create a user-clinic association
   */
  static async createUserClinicAssociation(
    page: Page,
    userId: number,
    clinicId: number,
    options: {
      roles?: string[];
      fullName?: string;
      isActive?: boolean;
    } = {}
  ): Promise<UserClinicAssociation> {
    const apiBaseUrl = this.getApiBaseUrl(page);
    const response = await page.request.post(`${apiBaseUrl}/test/user-clinic-associations`, {
      data: {
        user_id: userId,
        clinic_id: clinicId,
        roles: options.roles || ['admin', 'practitioner'],
        full_name: options.fullName,
        is_active: options.isActive !== undefined ? options.isActive : true,
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`Failed to create user-clinic association: ${response.status()} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Create a user with multiple clinic associations
   * This is useful for testing clinic switching scenarios
   */
  static async createUserWithClinics(
    page: Page,
    email: string,
    clinicNames: string[] = ['Clinic A', 'Clinic B']
  ): Promise<{ user: User; clinics: Clinic[]; associations: UserClinicAssociation[] }> {
    // Create user
    const user = await this.createUser(page, email);

    // Create clinics
    const clinics: Clinic[] = [];
    for (const name of clinicNames) {
      const clinic = await this.createClinic(page, name);
      clinics.push(clinic);
    }

    // Create associations
    const associations: UserClinicAssociation[] = [];
    for (const clinic of clinics) {
      const association = await this.createUserClinicAssociation(page, user.id, clinic.id);
      associations.push(association);
    }

    return { user, clinics, associations };
  }

  /**
   * Delete a test clinic
   */
  static async deleteClinic(page: Page, clinicId: number): Promise<void> {
    const apiBaseUrl = this.getApiBaseUrl(page);
    const response = await page.request.delete(`${apiBaseUrl}/test/clinics/${clinicId}`);

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`Failed to delete clinic: ${response.status()} ${errorText}`);
    }
  }

  /**
   * Delete a test user
   */
  static async deleteUser(page: Page, userId: number): Promise<void> {
    const apiBaseUrl = this.getApiBaseUrl(page);
    const response = await page.request.delete(`${apiBaseUrl}/test/users/${userId}`);

    if (!response.ok()) {
      const errorText = await response.text();
      throw new Error(`Failed to delete user: ${response.status()} ${errorText}`);
    }
  }
}

