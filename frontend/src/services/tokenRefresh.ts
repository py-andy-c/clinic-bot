/**
 * Token Refresh Service
 * 
 * Centralized service for refreshing authentication tokens.
 * Uses localStorage for token storage.
 * 
 * Flow:
 * 1. Get refresh token from localStorage
 * 2. Send refresh request with token in request body
 * 3. Store new tokens in localStorage
 * 4. Optionally validate new token and return user data
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { authStorage } from '../utils/storage';
import { AuthUser } from '../types';

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  user?: AuthUser;  // User data included in refresh response (eliminates need for /auth/verify)
}

export interface RefreshTokenOptions {
  // validateToken option removed - user data is now always included in refresh response
}

export interface RefreshTokenResult {
  accessToken: string;
  refreshToken?: string;
  userData?: AuthUser;
}

export class TokenRefreshService {
  private refreshInProgress: Promise<RefreshTokenResult> | null = null;

  /**
   * Refresh the access token
   * 
   * @param options - Refresh options
   * @returns Promise with refresh result
   * @throws Error if refresh fails
   */
  async refreshToken(options: RefreshTokenOptions = {}): Promise<RefreshTokenResult> {
    // If refresh is already in progress, return the existing promise
    if (this.refreshInProgress) {
      logger.log('TokenRefreshService: Refresh already in progress, waiting...');
      return this.refreshInProgress;
    }

    // Create refresh promise
    this.refreshInProgress = this.performRefresh(options).finally(() => {
      this.refreshInProgress = null;
    });

    return this.refreshInProgress;
  }

  /**
   * Perform the actual token refresh
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async performRefresh(_options: RefreshTokenOptions): Promise<RefreshTokenResult> {
    try {
      logger.log('TokenRefreshService: Attempting to refresh token...');

      // Always create a new axios client to avoid interceptor loops
      const client = this.createAxiosClient();
      
      // Get refresh token from localStorage
      const refreshToken = authStorage.getRefreshToken();
      if (!refreshToken) {
        logger.error('TokenRefreshService: No refresh token available in localStorage');
        throw new Error('找不到重新整理權杖');
      }

      logger.log('TokenRefreshService: Sending refresh request to /auth/refresh');
      // Send refresh request with token in request body
      const response = await client.post<RefreshTokenResponse>('/auth/refresh', {
        refresh_token: refreshToken,
      });

      // Extract tokens and user data from response
      const data = response.data;
      if (!data.access_token) {
        throw new Error('重新整理權杖回應缺少存取權杖');
      }

      // Store new tokens
      this.storeTokens(data.access_token, data.refresh_token);

      // User data is now included in refresh response (eliminates need for /auth/verify)
      const userData: AuthUser | undefined = data.user;

      const result: RefreshTokenResult = {
        accessToken: data.access_token,
        ...(userData && { userData }),
      };
      
      if (data.refresh_token) {
        result.refreshToken = data.refresh_token;
      }
      
      return result;
    } catch (error: unknown) {
      logger.error('TokenRefreshService: Token refresh failed:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('重新整理權杖失敗：未知錯誤');
    }
  }

  /**
   * Store tokens in localStorage
   */
  private storeTokens(accessToken: string, refreshToken?: string): void {
    try {
      authStorage.setAccessToken(accessToken);

      if (refreshToken) {
        authStorage.setRefreshToken(refreshToken);
      }
    } catch (error) {
      logger.error('TokenRefreshService: Failed to store tokens:', error);
      throw new Error('無法儲存認證權杖');
    }
  }


  /**
   * Create axios client for token refresh
   */
  private createAxiosClient(): AxiosInstance {
    return axios.create({
      baseURL: config.apiBaseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Check if a refresh is currently in progress
   */
  isRefreshing(): boolean {
    return this.refreshInProgress !== null;
  }

  /**
   * Clear any in-progress refresh (for testing/cleanup)
   */
  clearRefresh(): void {
    this.refreshInProgress = null;
  }
}

// Export singleton instance
export const tokenRefreshService = new TokenRefreshService();
