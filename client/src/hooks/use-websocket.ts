import { useEffect, useRef, useState, useCallback } from 'react';

interface JobUpdate {
  type: 'job_progress' | 'job_completed' | 'extraction_started' | 'extraction_completed' | 'connected' | 'pong';
  jobId?: number;
  schoolId?: string;
  data?: Record<string, any>;
  message?: string;
}

interface UseWebSocketOptions {
  onJobProgress?: (update: JobUpdate) => void;
  onJobCompleted?: (update: JobUpdate) => void;
  autoSubscribeAll?: boolean;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<JobUpdate | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);
  
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    shouldReconnectRef.current = true;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setIsConnected(true);
        
        if (options.autoSubscribeAll) {
          ws.send(JSON.stringify({ type: 'subscribe_all' }));
        }
      };
      
      ws.onmessage = (event) => {
        try {
          const update: JobUpdate = JSON.parse(event.data);
          setLastUpdate(update);
          
          if (update.type === 'job_progress' && options.onJobProgress) {
            options.onJobProgress(update);
          }
          
          if (update.type === 'job_completed' && options.onJobCompleted) {
            options.onJobCompleted(update);
          }
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };
      
      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setIsConnected(false);
        wsRef.current = null;
        
        if (shouldReconnectRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[WebSocket] Reconnecting...');
            connect();
          }, 3000);
        }
      };
      
      ws.onerror = (err) => {
        console.error('[WebSocket] Error:', err);
      };
    } catch (err) {
      console.error('[WebSocket] Failed to connect:', err);
    }
  }, [options]);
  
  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);
  
  const subscribeToJob = useCallback((jobId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe_job', jobId }));
    }
  }, []);
  
  const subscribeToSchool = useCallback((schoolId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe_school', schoolId }));
    }
  }, []);
  
  const unsubscribeFromJob = useCallback((jobId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe_job', jobId }));
    }
  }, []);
  
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);
  
  return {
    isConnected,
    lastUpdate,
    subscribeToJob,
    subscribeToSchool,
    unsubscribeFromJob,
    connect,
    disconnect,
  };
}
