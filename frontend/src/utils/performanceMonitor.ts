/**
 * Performance Monitoring Utility
 * Tracks API call patterns and performance metrics for calendar operations
 */

// Environment-based monitoring toggle
// Disabled in production by default to minimize overhead
// Can be enabled via environment variable for performance analysis
const ENABLE_PERFORMANCE_MONITORING = process.env.NODE_ENV !== 'production' ||
                                      process.env.ENABLE_CALENDAR_MONITORING === 'true';

interface APICallMetrics {
  endpoint: string;
  method: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  cacheHit?: boolean;
  error?: string;
}

interface PerformanceStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageDuration: number;
  cacheHitRate: number;
  callsByEndpoint: Record<string, number>;
  recentCalls: APICallMetrics[];
}

class PerformanceMonitor {
  private metrics: APICallMetrics[] = [];
  private maxMetricsHistory = 100;
  private activeCalls = new Map<string, APICallMetrics>();

  /**
   * Generate unique call ID
   */
  private generateCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Track API call start
   */
  trackCallStart(endpoint: string, method: string = 'GET'): string {
    if (!ENABLE_PERFORMANCE_MONITORING) {
      return 'disabled'; // Return dummy ID when monitoring is disabled
    }

    const callId = this.generateCallId();
    const metric: APICallMetrics = {
      endpoint,
      method,
      startTime: Date.now(),
      success: false
    };

    this.metrics.push(metric);
    this.activeCalls.set(callId, metric);
    this.cleanupOldMetrics();

    return callId;
  }

  /**
   * Track API call completion
   */
  trackCallEnd(callId: string, success: boolean, cacheHit: boolean = false, error?: string): void {
    if (!ENABLE_PERFORMANCE_MONITORING || callId === 'disabled') {
      return; // Skip tracking if disabled or dummy ID
    }

    const metric = this.activeCalls.get(callId);
    if (!metric) return;

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;
    metric.success = success;
    metric.cacheHit = cacheHit;
    if (error !== undefined) {
      metric.error = error;
    }

    // Remove from active calls
    this.activeCalls.delete(callId);
  }

  /**
   * Get performance statistics
   */
  getStats(): PerformanceStats {
    if (!ENABLE_PERFORMANCE_MONITORING) {
      return {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        averageDuration: 0,
        cacheHitRate: 0,
        callsByEndpoint: {},
        recentCalls: []
      };
    }

    const totalCalls = this.metrics.length;
    const successfulCalls = this.metrics.filter(m => m.success).length;
    const failedCalls = totalCalls - successfulCalls;
    const completedCalls = this.metrics.filter(m => m.duration !== undefined);

    const averageDuration = completedCalls.length > 0
      ? completedCalls.reduce((sum, m) => sum + (m.duration || 0), 0) / completedCalls.length
      : 0;

    const cacheHits = this.metrics.filter(m => m.cacheHit).length;
    const cacheHitRate = totalCalls > 0 ? (cacheHits / totalCalls) * 100 : 0;

    const callsByEndpoint: Record<string, number> = {};
    this.metrics.forEach(m => {
      callsByEndpoint[m.endpoint] = (callsByEndpoint[m.endpoint] || 0) + 1;
    });

    const recentCalls = this.metrics.slice(-10); // Last 10 calls

    return {
      totalCalls,
      successfulCalls,
      failedCalls,
      averageDuration,
      cacheHitRate,
      callsByEndpoint,
      recentCalls
    };
  }

  /**
   * Get calendar-specific performance metrics
   */
  getCalendarStats(): {
    totalCalendarCalls: number;
    batchCalendarCalls: number;
    resourceCalendarCalls: number;
    averageCalendarDuration: number;
    calendarCacheHitRate: number;
    apiReductionEstimate: number;
  } {
    if (!ENABLE_PERFORMANCE_MONITORING) {
      return {
        totalCalendarCalls: 0,
        batchCalendarCalls: 0,
        resourceCalendarCalls: 0,
        averageCalendarDuration: 0,
        calendarCacheHitRate: 0,
        apiReductionEstimate: 0
      };
    }

    const calendarMetrics = this.metrics.filter(m =>
      m.endpoint.includes('/calendar') ||
      m.endpoint.includes('calendar/batch') ||
      m.endpoint.includes('calendar/batch-resource')
    );

    const totalCalendarCalls = calendarMetrics.length;
    const batchCalendarCalls = calendarMetrics.filter(m =>
      m.endpoint.includes('calendar/batch') && !m.endpoint.includes('resource')
    ).length;
    const resourceCalendarCalls = calendarMetrics.filter(m =>
      m.endpoint.includes('calendar/batch-resource')
    ).length;

    const completedCalendarCalls = calendarMetrics.filter(m => m.duration !== undefined);
    const averageCalendarDuration = completedCalendarCalls.length > 0
      ? completedCalendarCalls.reduce((sum, m) => sum + (m.duration || 0), 0) / completedCalendarCalls.length
      : 0;

    const calendarCacheHits = calendarMetrics.filter(m => m.cacheHit).length;
    const calendarCacheHitRate = totalCalendarCalls > 0 ? (calendarCacheHits / totalCalendarCalls) * 100 : 0;

    // Estimate API reduction: assume 70% target, calculate current vs target
    const estimatedReduction = calendarCacheHitRate > 0 ? Math.min(calendarCacheHitRate / 70 * 100, 100) : 0;

    return {
      totalCalendarCalls,
      batchCalendarCalls,
      resourceCalendarCalls,
      averageCalendarDuration,
      calendarCacheHitRate,
      apiReductionEstimate: estimatedReduction
    };
  }

  /**
   * Reset metrics (useful for testing or new sessions)
   */
  reset(): void {
    this.metrics = [];
  }

  /**
   * Cleanup old metrics to prevent memory leaks
   */
  private cleanupOldMetrics(): void {
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }
  }

  /**
   * Export metrics for debugging
   */
  exportMetrics(): APICallMetrics[] {
    return [...this.metrics];
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();

// Check if performance monitoring is enabled
export function isPerformanceMonitoringEnabled(): boolean {
  return ENABLE_PERFORMANCE_MONITORING;
}

// Calendar-specific monitoring functions
export function trackCalendarAPICall(endpoint: string, method: string = 'GET'): string {
  return performanceMonitor.trackCallStart(endpoint, method);
}

export function completeCalendarAPICall(callId: string, success: boolean, cacheHit: boolean = false, error?: string): void {
  performanceMonitor.trackCallEnd(callId, success, cacheHit, error);
}

export function getCalendarPerformanceStats() {
  return performanceMonitor.getCalendarStats();
}

export function getOverallPerformanceStats() {
  return performanceMonitor.getStats();
}

export function resetPerformanceMetrics() {
  performanceMonitor.reset();
}

// Export for testing
export { PerformanceMonitor };