/**
 * Health Monitor - Extraction Metrics & Observability
 * 
 * Tracks success/fail rates, hit rates (% with emails),
 * parser performance, and AI enhancement usage.
 */

export interface ExtractionEvent {
  schoolId?: string;
  success: boolean;
  contactsFound: number;
  aiEnhanced: number;
  timeTakenMs: number;
  parserUsed: string;
  method: 'cors-proxy' | 'playwright';
  timestamp?: Date;
}

export interface HealthStats {
  totalExtractions: number;
  successfulExtractions: number;
  failedExtractions: number;
  successRate: number;
  
  totalContactsFound: number;
  aiEnhancedContacts: number;
  aiUsageRate: number;
  
  avgExtractionTimeMs: number;
  minExtractionTimeMs: number;
  maxExtractionTimeMs: number;
  
  parserBreakdown: Record<string, { count: number; contacts: number; avgTime: number }>;
  methodBreakdown: Record<string, { count: number; successRate: number }>;
  
  hitRate: number;
  
  lastHourExtractions: number;
  lastHourSuccessRate: number;
  
  recentErrors: Array<{ schoolId?: string; error: string; timestamp: Date }>;
}

class HealthMonitor {
  private events: ExtractionEvent[] = [];
  private errors: Array<{ schoolId?: string; error: string; timestamp: Date }> = [];
  private readonly maxEvents = 10000;
  private readonly maxErrors = 100;

  recordExtraction(event: ExtractionEvent): void {
    this.events.push({
      ...event,
      timestamp: new Date(),
    });

    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  recordError(schoolId: string | undefined, error: string): void {
    this.errors.push({
      schoolId,
      error,
      timestamp: new Date(),
    });

    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }
  }

  getStats(): HealthStats {
    const total = this.events.length;
    const successful = this.events.filter(e => e.success).length;
    const failed = total - successful;

    const totalContacts = this.events.reduce((sum, e) => sum + e.contactsFound, 0);
    const aiEnhanced = this.events.reduce((sum, e) => sum + e.aiEnhanced, 0);
    
    const times = this.events.map(e => e.timeTakenMs);
    const avgTime = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const minTime = times.length > 0 ? Math.min(...times) : 0;
    const maxTime = times.length > 0 ? Math.max(...times) : 0;

    const parserBreakdown: Record<string, { count: number; contacts: number; avgTime: number }> = {};
    const parserGroups = new Map<string, ExtractionEvent[]>();
    
    for (const event of this.events) {
      const parser = event.parserUsed || 'unknown';
      if (!parserGroups.has(parser)) {
        parserGroups.set(parser, []);
      }
      parserGroups.get(parser)!.push(event);
    }

    Array.from(parserGroups.entries()).forEach(([parser, events]) => {
      const contacts = events.reduce((sum: number, e: ExtractionEvent) => sum + e.contactsFound, 0);
      const totalTime = events.reduce((sum: number, e: ExtractionEvent) => sum + e.timeTakenMs, 0);
      parserBreakdown[parser] = {
        count: events.length,
        contacts,
        avgTime: Math.round(totalTime / events.length),
      };
    });

    const methodBreakdown: Record<string, { count: number; successRate: number }> = {};
    const methodGroups = new Map<string, ExtractionEvent[]>();
    
    for (const event of this.events) {
      if (!methodGroups.has(event.method)) {
        methodGroups.set(event.method, []);
      }
      methodGroups.get(event.method)!.push(event);
    }

    Array.from(methodGroups.entries()).forEach(([method, events]) => {
      const successCount = events.filter((e: ExtractionEvent) => e.success).length;
      methodBreakdown[method] = {
        count: events.length,
        successRate: events.length > 0 ? Math.round((successCount / events.length) * 100) : 0,
      };
    });

    const withContacts = this.events.filter(e => e.contactsFound > 0).length;
    const hitRate = total > 0 ? Math.round((withContacts / total) * 100) : 0;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lastHourEvents = this.events.filter(e => e.timestamp && e.timestamp > oneHourAgo);
    const lastHourSuccess = lastHourEvents.filter(e => e.success).length;

    return {
      totalExtractions: total,
      successfulExtractions: successful,
      failedExtractions: failed,
      successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
      
      totalContactsFound: totalContacts,
      aiEnhancedContacts: aiEnhanced,
      aiUsageRate: totalContacts > 0 ? Math.round((aiEnhanced / totalContacts) * 100) : 0,
      
      avgExtractionTimeMs: avgTime,
      minExtractionTimeMs: minTime,
      maxExtractionTimeMs: maxTime,
      
      parserBreakdown,
      methodBreakdown,
      
      hitRate,
      
      lastHourExtractions: lastHourEvents.length,
      lastHourSuccessRate: lastHourEvents.length > 0 
        ? Math.round((lastHourSuccess / lastHourEvents.length) * 100) 
        : 0,
      
      recentErrors: this.errors.slice(-10),
    };
  }

  getParserPerformance(): Array<{ parser: string; successRate: number; avgContacts: number; avgTime: number }> {
    const stats = this.getStats();
    return Object.entries(stats.parserBreakdown).map(([parser, data]) => ({
      parser,
      successRate: data.count > 0 ? Math.round((data.contacts / data.count) * 100) : 0,
      avgContacts: data.count > 0 ? Math.round(data.contacts / data.count) : 0,
      avgTime: data.avgTime,
    }));
  }

  reset(): void {
    this.events = [];
    this.errors = [];
  }
}

export const healthMonitor = new HealthMonitor();
