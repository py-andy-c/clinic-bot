import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';
import { ApiErrorType, getErrorMessage } from '../../types';

/**
 * Base API client class providing common axios setup and error handling
 * 
 * TODO: Migrate ApiService and LiffApiService to extend this base class
 * This will reduce duplication and standardize error handling across API services.
 * 
 * Migration steps:
 * 1. Refactor ApiService to extend ApiClient
 * 2. Refactor LiffApiService to extend ApiClient
 * 3. Move common interceptor logic to base class
 * 4. Update tests to reflect new structure
 */
export abstract class ApiClient {
  protected client: AxiosInstance;

  constructor(baseURL: string = config.apiBaseUrl, timeout: number = 10000) {
    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Setup request and response interceptors
   * Override in subclasses for specific behavior
   */
  protected setupInterceptors(): void {
    // Request interceptor - can be overridden
    this.client.interceptors.request.use(
      (config) => this.onRequest(config),
      (error) => this.onRequestError(error)
    );

    // Response interceptor - can be overridden
    this.client.interceptors.response.use(
      (response) => this.onResponse(response),
      (error) => this.onResponseError(error)
    );
  }

  /**
   * Request interceptor handler
   * Note: Uses InternalAxiosRequestConfig for axios interceptor compatibility
   */
  protected onRequest(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig> {
    return config;
  }

  /**
   * Request error handler
   */
  protected onRequestError(error: ApiErrorType): Promise<never> {
    logger.error('Request error:', error);
    return Promise.reject(error);
  }

  /**
   * Response interceptor handler
   */
  protected onResponse(response: AxiosResponse): AxiosResponse {
    return response;
  }

  /**
   * Response error handler
   */
  protected onResponseError(error: ApiErrorType): Promise<never> {
    logger.error('Response error:', error);
    return Promise.reject(error);
  }

  /**
   * Extract data from successful response
   */
  protected handleSuccess<T>(response: AxiosResponse<T>): T {
    return response.data;
  }

  /**
   * Handle API errors consistently
   */
  protected handleError(error: ApiErrorType): never {
    const message = getErrorMessage(error);
    logger.error('API Error:', message);
    throw new Error(message);
  }

  /**
   * Make a GET request
   */
  protected async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.get<T>(url, config);
      return this.handleSuccess(response);
    } catch (error) {
      this.handleError(error as ApiErrorType);
    }
  }

  /**
   * Make a POST request
   */
  protected async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.post<T>(url, data, config);
      return this.handleSuccess(response);
    } catch (error) {
      this.handleError(error as ApiErrorType);
    }
  }

  /**
   * Make a PUT request
   */
  protected async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.put<T>(url, data, config);
      return this.handleSuccess(response);
    } catch (error) {
      this.handleError(error as ApiErrorType);
    }
  }

  /**
   * Make a PATCH request
   */
  protected async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.patch<T>(url, data, config);
      return this.handleSuccess(response);
    } catch (error) {
      this.handleError(error as ApiErrorType);
    }
  }

  /**
   * Make a DELETE request
   */
  protected async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.delete<T>(url, config);
      return this.handleSuccess(response);
    } catch (error) {
      this.handleError(error as ApiErrorType);
    }
  }
}
