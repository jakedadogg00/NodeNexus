import http from 'node:http';
import { SystemGovernor } from './governor.js';
import { NodePoolManager } from './nodepool.js';
import { NodePoolIPCServer } from './ipc_server.js';
import { getDashboardHtml } from './dashboard_html.js';

const PORT = parseInt(process.env.SYSGOV_PORT || '18890', 10);
const HOST = process.env.SYSGOV_HOST || '127.0.0.1';

// 1. Initialize Modular System Governor
const governor = new SystemGovernor({
  pollIntervalMs: 4000
});

// 2. Initialize NodePool Manager
const poolManager = new NodePoolManager({
  defaultIdleTimeoutMs: 60000
});

poolManager.on('log', (msg, type) => governor.log(msg, type));

// 3. Start Local IPC Bridge (/tmp/nodepool.sock)
const ipcServer = new NodePoolIPCServer(poolManager);
ipcServer.start();

// 4. Start Autonomous Governor
governor.startGoverning();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: governor.getStatus(),
      pool: poolManager.getStatus(),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // REST API: GET /api/health
  if (url.pathname === '/api/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      healthy: !governor.watchdog.inSafeMode,
      mode: governor.policy.mode,
      governorRSS: governor.latestState.telemetry?.governor.rssMB || 0,
      uptimeSec: Math.round(process.uptime())
    }));
    return;
  }

  // REST API: GET /api/workloads
  if (url.pathname === '/api/workloads' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(governor.latestState.workloads || []));
    return;
  }

  // REST API: GET /api/forecast
  if (url.pathname === '/api/forecast' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(governor.latestState.forecast || {}));
    return;
  }

  // REST API: GET /api/policies
  if (url.pathname === '/api/policies' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mode: governor.policy.mode,
      maxTotalNodeRSSMB: governor.policy.maxTotalNodeRSSMB,
      maxSingleProcessRSSMB: governor.policy.maxSingleProcessRSSMB,
      memoryPressureThresholdPercent: governor.policy.memoryPressureThresholdPercent
    }));
    return;
  }

  // REST API: POST /api/mode/:mode
  const modeMatch = url.pathname.match(/^\/api\/mode\/([a-zA-Z0-9_-]+)$/);
  if (modeMatch && method === 'POST') {
    const success = governor.policy.setMode(modeMatch[1]);
    res.writeHead(success ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success, mode: governor.policy.mode }));
    return;
  }

  // REST API: GET /api/pool/status
  if (url.pathname === '/api/pool/status' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(poolManager.getStatus()));
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
    const dryRun = url.searchParams.get('dryRun') === 'true';
    try {
      const result = await governor.optimizeAll(dryRun);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // REST API: POST /api/rollback/:actionId
  const rollbackMatch = url.pathname.match(/^\/api\/rollback\/([a-zA-Z0-9_-]+)$/);
  if (rollbackMatch && method === 'POST') {
    const result = await governor.actuators.rollbackAction(rollbackMatch[1]);
    res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // REST API: POST /api/safe-mode
  if (url.pathname === '/api/safe-mode' && method === 'POST') {
    governor.watchdog.triggerSafeMode('User initiated via API');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, mode: governor.policy.mode }));
    return;
  }

  // REST API: POST /api/shutdown
  if (url.pathname === '/api/shutdown' && method === 'POST') {
    governor.watchdog.triggerEmergencyShutdown();
    await poolManager.spinDownAll();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Emergency shutdown complete.' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`[OpenClaw SysGov v3.0] Control Plane active at http://${HOST}:${PORT}`);
  console.log(`[OpenClaw SysGov v3.0] IPC Bridge active at /tmp/nodepool.sock`);
});

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
