import http from 'node:http';
import { SystemGovernor } from './governor.js';
import { NodePoolManager } from './nodepool.js';
import { NodePoolIPCServer } from './ipc_server.js';
import { getDashboardHtml } from './dashboard_html.js';

const PORT = parseInt(process.env.SYSGOV_PORT || '18890', 10);
const HOST = process.env.SYSGOV_HOST || '127.0.0.1';

// 1. Initialize System Governor
const governor = new SystemGovernor({
  maxNodeRSSMB: 1600,
  perProcessMaxMB: 500,
  pollIntervalMs: 4000
});

// 2. Initialize NodePool Manager
const poolManager = new NodePoolManager({
  defaultIdleTimeoutMs: 60000 // 60s idle auto-spin-down
});

// Pipe pool events to governor log
poolManager.on('log', (msg, type) => governor.log(msg, type));

// 3. Start IPC Socket Server (/tmp/nodepool.sock)
const ipcServer = new NodePoolIPCServer(poolManager);
ipcServer.start();

// 4. Start Autonomous Governor
governor.startGoverning();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Dashboard UI
  if (url.pathname === '/' || url.pathname === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getDashboardHtml());
    return;
  }

  // REST API: GET /api/status
  if (url.pathname === '/api/status' && method === 'GET') {
    try {
      const memory = await governor.getSystemMemoryStats();
      const processes = await governor.scanProcesses();
      const pool = poolManager.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        memory,
        processes,
        pool,
        logs: governor.logs
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // REST API: GET /api/pool/status
  if (url.pathname === '/api/pool/status' && method === 'GET') {
    try {
      const status = poolManager.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // REST API: POST /api/pool/:name/warm
  const warmMatch = url.pathname.match(/^\/api\/pool\/([a-zA-Z0-9_-]+)\/warm$/);
  if (warmMatch && method === 'POST') {
    const name = warmMatch[1];
    try {
      const instance = await poolManager.acquireServer(name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, name, pid: instance.pid }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // REST API: POST /api/pool/:name/sleep
  const sleepMatch = url.pathname.match(/^\/api\/pool\/([a-zA-Z0-9_-]+)\/sleep$/);
  if (sleepMatch && method === 'POST') {
    const name = sleepMatch[1];
    try {
      await poolManager.spinDownServer(name, 'manual user request');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, name }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // REST API: POST /api/pool/sleep-all
  if (url.pathname === '/api/pool/sleep-all' && method === 'POST') {
    try {
      await poolManager.spinDownAll();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // REST API: POST /api/optimize
  if (url.pathname === '/api/optimize' && method === 'POST') {
    try {
      const result = await governor.optimizeAll();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // REST API: Process Actions /api/process/:pid/:action
  const procMatch = url.pathname.match(/^\/api\/process\/(\d+)\/(pause|resume|kill|qos)$/);
  if (procMatch && method === 'POST') {
    const pid = parseInt(procMatch[1], 10);
    const action = procMatch[2];

    let success = false;
    if (action === 'pause') success = await governor.pauseProcess(pid);
    else if (action === 'resume') success = await governor.resumeProcess(pid);
    else if (action === 'kill') success = await governor.terminateProcess(pid, false);
    else if (action === 'qos') success = await governor.applyQoSEfficiency(pid);

    res.writeHead(success ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success, pid, action }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`[NodeNexus] Running at http://${HOST}:${PORT}`);
  console.log(`[NodeNexus] IPC Socket active at /tmp/nodepool.sock`);
});

// Clean shutdown
process.on('SIGTERM', () => {
  poolManager.spinDownAll();
  ipcServer.stop();
  governor.stopGoverning();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  poolManager.spinDownAll();
  ipcServer.stop();
  governor.stopGoverning();
  server.close(() => process.exit(0));
});
