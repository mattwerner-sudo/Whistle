import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

interface JobUpdate {
  type: 'job_progress' | 'job_completed' | 'extraction_started' | 'extraction_completed';
  jobId?: number;
  schoolId?: string;
  data: Record<string, any>;
}

interface Client {
  ws: WebSocket;
  subscribedJobs: Set<number>;
  subscribedSchools: Set<string>;
}

let wss: WebSocketServer | null = null;
const clients = new Map<WebSocket, Client>();

export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected');
    
    const client: Client = {
      ws,
      subscribedJobs: new Set(),
      subscribedSchools: new Set(),
    };
    clients.set(ws, client);
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(client, message);
      } catch (err) {
        console.error('[WebSocket] Invalid message:', err);
      }
    });
    
    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected');
      clients.delete(ws);
    });
    
    ws.on('error', (err) => {
      console.error('[WebSocket] Client error:', err);
      clients.delete(ws);
    });
    
    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));
  });
  
  console.log('[WebSocket] Server initialized on /ws');
  return wss;
}

function handleClientMessage(client: Client, message: any) {
  switch (message.type) {
    case 'subscribe_job':
      if (message.jobId) {
        client.subscribedJobs.add(message.jobId);
        console.log(`[WebSocket] Client subscribed to job ${message.jobId}`);
      }
      break;
    case 'unsubscribe_job':
      if (message.jobId) {
        client.subscribedJobs.delete(message.jobId);
      }
      break;
    case 'subscribe_school':
      if (message.schoolId) {
        client.subscribedSchools.add(message.schoolId);
        console.log(`[WebSocket] Client subscribed to school ${message.schoolId}`);
      }
      break;
    case 'unsubscribe_school':
      if (message.schoolId) {
        client.subscribedSchools.delete(message.schoolId);
      }
      break;
    case 'subscribe_all':
      client.subscribedJobs.add(-1);
      console.log('[WebSocket] Client subscribed to all updates');
      break;
    case 'ping':
      client.ws.send(JSON.stringify({ type: 'pong' }));
      break;
  }
}

export function broadcastJobUpdate(update: JobUpdate) {
  if (!wss) return;
  
  const message = JSON.stringify(update);
  
  clients.forEach((client) => {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    
    const isSubscribedToAll = client.subscribedJobs.has(-1);
    const isSubscribedToJob = update.jobId && client.subscribedJobs.has(update.jobId);
    const isSubscribedToSchool = update.schoolId && client.subscribedSchools.has(update.schoolId);
    
    if (isSubscribedToAll || isSubscribedToJob || isSubscribedToSchool) {
      client.ws.send(message);
    }
  });
}

export function broadcastToAll(update: JobUpdate) {
  if (!wss) return;
  
  const message = JSON.stringify(update);
  
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

export function getConnectedClientCount(): number {
  return clients.size;
}
