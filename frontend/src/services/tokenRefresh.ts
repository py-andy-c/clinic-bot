/**
 * Token Refresh Service
 * 
 * Centralized service for refreshing authentication tokens.
 * Handles both cookie-based and localStorage fallback mechanisms.
 * 
 * Flow:
 * 1. Try to refresh using HttpOnly cookie (preferred)
 * 2. Fallback to localStorage refresh token if cookie fails (Safari ITP workaround)
 * 3. Store new tokens in localStorage
 * 4. Optionally validate new token and return user data
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { authStorage } from '../utils/storage';
import { ApiErrorType, AuthUser } from '../types';

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
}

export interface RefreshTokenOptions {
  /**
   * Whether to validate the new token and return user data
   * @default false
   */
  validateToken?: boolean;
  
  /**
   * Custom axios instance to use (for interceptors)
   * @default undefined (creates new instance)
   */
  axiosInstance?: AxiosInstance;
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
  private async performRefresh(options: RefreshTokenOptions): Promise<RefreshTokenResult> {
    try {
      logger.log('TokenRefreshService: Attempting to refresh token...');

      const client = options.axiosInstance || this.createAxiosClient();
      let response;
      let refreshTokenSource = 'cookie';

      // Step 1: Try HttpOnly cookie first (preferred method)
      try {
        response = await client.post<RefreshTokenResponse>('/auth/refresh', {}, {
          withCredentials: true,
        });
        logger.log('TokenRefreshService: Token refreshed via cookie');
      } catch (cookieError: ApiErrorType) {
        logger.warn('TokenRefreshService: Cookie refresh failed, trying localStorage fallback');

        // Step 2: Fallback to localStorage if cookie fails (Safari ITP workaround)
        const refreshToken = authStorage.getRefreshToken();
        if (refreshToken) {
          logger.log('TokenRefreshService: Using localStorage refresh token fallback');
          try {
            response = await client.post<RefreshTokenResponse>('/auth/refresh', {
              refresh_token: refreshToken,
            }, {
              withCredentials: true,
            });
            refreshTokenSource = 'localStorage';
            logger.log('TokenRefreshService: Token refreshed via localStorage fallback');
          } catch (fallbackError: ApiErrorType) {
            logger.error('TokenRefreshService: Both cookie and localStorage refresh failed');
            throw fallbackError;
          }
        } else {
          logger.error('TokenRefreshService: No refresh token available in localStorage');
          throw cookieError;
        }
      }

      // Step 3: Extract tokens from response
      const data = response.data;
      if (!data.access_token) {
        throw new Error('Token refresh response missing access_token');
      }

      // Step 4: Store new tokens
      this.storeTokens(data.access_token, data.refresh_token);
      logger.log(`TokenRefreshService: New tokens stored (via ${refreshTokenSource})`);

      // Step 5: Optionally validate token and get user data
      let userData: AuthUser | undefined = undefined;
      if (options.validateToken) {
        userData = await this.validateToken(data.access_token, client);
      }

      const result: RefreshTokenResult = {
        accessToken: data.access_token,
        ...(userData && { userData }),
      };
      
      if (data.refresh_token) {
        result.refreshToken = data.refresh_token;
      }
      
      return result;
    } catch (error: ApiErrorType) {
      logger.error('TokenRefreshService: Token refresh failed:', error);
      throw error;
    }
  }

  /**
   * Store tokens in localStorage
   */
  private storeTokens(accessToken: string, refreshToken?: string): void {
    try {
      authStorage.setAccessToken(accessToken);
      authStorage.setWasLoggedIn(true);

      if (refreshToken) {
        authStorage.setRefreshToken(refreshToken);
      }
    } catch (error) {
      logger.error('TokenRefreshService: Failed to store tokens:', error);
      throw new Error('Failed to persist authentication tokens');
    }
  }

  /**
   * Validate token and get user data
   */
  private async validateToken(accessToken: string, client: AxiosInstance): Promise<AuthUser> {
    try {
      const response = await client.get('/auth/verify', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      return response.data;
    } catch (error: ApiErrorType) {
      logger.error('TokenRefreshService: Token validation failed:', error);
      throw new Error('Token validation failed after refresh');
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
      withCredentials: true,
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
