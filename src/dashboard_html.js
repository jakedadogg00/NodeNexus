export function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw NodeNexus & System Governor</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border-color: #30363d;
      --text-primary: #c9d1d9;
      --text-secondary: #8b949e;
      --text-bright: #f0f6fc;
      --accent-blue: #58a6ff;
      --accent-green: #3fb950;
      --accent-orange: #d29922;
      --accent-red: #f85149;
      --accent-purple: #bc8cff;
      --font-mono: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-sans);
      padding: 24px;
      -webkit-font-smoothing: antialiased;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }
    .logo-group h1 {
      font-size: 20px;
      font-weight: 600;
      color: var(--text-bright);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-badge {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 8px;
      border-radius: 12px;
      font-weight: 600;
      background: rgba(63, 185, 80, 0.15);
      color: var(--accent-green);
      border: 1px solid rgba(63, 185, 80, 0.4);
    }
    .controls-group { display: flex; gap: 10px; }
    .btn {
      background: var(--bg-tertiary);
      color: var(--text-bright);
      border: 1px solid var(--border-color);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn:hover { background: #30363d; border-color: #8b949e; }
    .btn-primary { background: #238636; border-color: rgba(240, 246, 252, 0.1); }
    .btn-primary:hover { background: #2ea043; }
    .btn-danger { background: rgba(248, 81, 73, 0.1); color: var(--accent-red); border-color: rgba(248, 81, 73, 0.3); }
    .btn-danger:hover { background: rgba(248, 81, 73, 0.2); }
    .btn-small { padding: 4px 8px; font-size: 11px; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
    }
    .stat-label {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value {
      font-size: 22px;
      font-weight: 600;
      color: var(--text-bright);
      font-family: var(--font-mono);
    }
    .stat-sub { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }

    .section-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .section-title { font-size: 16px; font-weight: 600; color: var(--text-bright); }

    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-secondary);
      font-weight: 500;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(48, 54, 61, 0.5);
      font-family: var(--font-mono);
    }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }

    .tag { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-family: var(--font-sans); }
    .tag-mcp { background: rgba(88, 166, 255, 0.15); color: var(--accent-blue); }
    .tag-node { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }
    .tag-sleeping { background: rgba(139, 148, 158, 0.15); color: var(--text-secondary); }
    .tag-warm { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); font-weight: 600; }

    .log-terminal {
      background: #090d13;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
      height: 180px;
      overflow-y: auto;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-primary);
    }
    .log-line { margin-bottom: 4px; }
    .log-time { color: var(--text-secondary); margin-right: 8px; }
    .log-success { color: var(--accent-green); }
    .log-action { color: var(--accent-blue); }
    .log-warn { color: var(--accent-orange); }
    .log-error { color: var(--accent-red); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-group">
        <h1>
          ⚡ OpenClaw NodeNexus
          <span class="status-badge">On-Demand MCP & QoS Engine</span>
        </h1>
      </div>
      <div class="controls-group">
        <button class="btn btn-primary" onclick="runOptimize()">⚡ 1-Click System Optimize</button>
        <button class="btn" onclick="sleepAll()">💤 Sleep All Servers (0 MB RAM)</button>
        <button class="btn" onclick="fetchData()">🔄 Refresh</button>
      </div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Estimated Memory Saved</div>
        <div class="stat-value" id="stat-mem-saved">-- MB</div>
        <div class="stat-sub" id="stat-sleeping-count">-- Sleeping Servers (0 RAM)</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Warm / Total Pool Servers</div>
        <div class="stat-value" id="stat-pool-counts">-- / --</div>
        <div class="stat-sub" id="stat-requests-handled">-- Handled Requests</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">System Memory Pressure</div>
        <div class="stat-value" id="stat-mem-pressure">--%</div>
        <div class="stat-sub" id="stat-mem-breakdown">Used: -- GB / -- GB</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">CPU Load Average</div>
        <div class="stat-value" id="stat-load-avg">--</div>
        <div class="stat-sub">1m, 5m, 15m</div>
      </div>
    </div>

    <!-- ON DEMAND MCP POOL SECTION -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">🚀 On-Demand MCP Pool (Lazy-Spawn & Auto-Sleep)</div>
        <div style="font-size: 13px; color: var(--text-secondary);">IPC Socket: <code>/tmp/nodepool.sock</code></div>
      </div>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Server Name</th>
              <th>Description</th>
              <th>Status</th>
              <th>PID</th>
              <th>Idle Auto-Sleep Countdown</th>
              <th>Handled Calls</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="pool-table-body">
            <tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">Loading pool catalog...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ACTIVE SYSTEM PROCESSES SECTION -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">🖥️ Managed System Processes (WindowServer & Node Instances)</div>
        <div id="process-summary" style="font-size: 13px; color: var(--text-secondary);">Scanning...</div>
      </div>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>PID</th>
              <th>Process Name</th>
              <th>Category</th>
              <th>CPU %</th>
              <th>RSS RAM</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="process-table-body">
            <tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">Loading processes...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ACTIVITY LOG TERMINAL -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">📋 Live Engine Event & Governor Logs</div>
      </div>
      <div class="log-terminal" id="log-terminal">
        <div class="log-line">Connecting to NodeNexus daemon...</div>
      </div>
    </div>
  </div>

  <script>
    async function fetchData() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        renderDashboard(data);
      } catch (err) {
        console.error('Failed to fetch status:', err);
      }
    }

    function renderDashboard(data) {
      if (data.pool) {
        document.getElementById('stat-mem-saved').innerText = '~' + data.pool.estimatedSavedMB + ' MB';
        document.getElementById('stat-sleeping-count').innerText = data.pool.sleepingInstancesCount + ' Sleeping (0 MB RAM)';
        document.getElementById('stat-pool-counts').innerText = data.pool.warmInstancesCount + ' / ' + data.pool.totalCatalogServers;
        document.getElementById('stat-requests-handled').innerText = data.pool.metrics.totalRequests + ' Handled Calls';

        const poolBody = document.getElementById('pool-table-body');
        poolBody.innerHTML = '';
        data.pool.servers.forEach(s => {
          const tr = document.createElement('tr');
          const isWarm = s.status === 'warm';
          const statusBadge = isWarm
            ? '<span class="tag tag-warm">🔥 WARM</span>'
            : '<span class="tag tag-sleeping">💤 SLEEPING (0MB)</span>';

          const idleText = isWarm
            ? \`<span style="color: var(--accent-green); font-weight: 600;">\${s.idleRemainingSec}s remaining</span>\`
            : '<span style="color: var(--text-secondary);">Asleep</span>';

          const actionBtn = isWarm
            ? \`<button class="btn btn-small btn-danger" onclick="sleepServer('\${s.name}')">Sleep (0MB)</button>\`
            : \`<button class="btn btn-small btn-primary" onclick="warmServer('\${s.name}')">Pre-Warm</button>\`;

          tr.innerHTML = \`
            <td style="color: var(--text-bright); font-weight: 600;">\${escapeHtml(s.name)}</td>
            <td style="color: var(--text-secondary); font-size: 12px;">\${escapeHtml(s.description)}</td>
            <td>\${statusBadge}</td>
            <td>\${s.pid || '-'}</td>
            <td>\${idleText}</td>
            <td>\${s.requestCount}</td>
            <td>\${actionBtn}</td>
          \`;
          poolBody.appendChild(tr);
        });
      }

      if (data.memory) {
        document.getElementById('stat-mem-pressure').innerText = data.memory.memPressurePercent + '%';
        document.getElementById('stat-mem-pressure').style.color = data.memory.memPressurePercent > 80 ? 'var(--accent-red)' : 'var(--text-bright)';
        document.getElementById('stat-mem-breakdown').innerText = \`Used: \${data.memory.usedGB} GB / \${data.memory.totalGB} GB\`;
        document.getElementById('stat-load-avg').innerText = data.memory.loadAvg.map(n => n.toFixed(2)).join(', ');
      }

      if (data.processes) {
        document.getElementById('process-summary').innerText = \`\${data.processes.length} system processes monitored\`;
        const tbody = document.getElementById('process-table-body');
        tbody.innerHTML = '';
        data.processes.forEach(proc => {
          const tr = document.createElement('tr');
          let catClass = 'tag-node';
          if (proc.category === 'mcp-server') catClass = 'tag-mcp';
          else if (proc.category === 'openclaw-agent') catClass = 'tag-agent';
          else if (proc.category === 'system-ui') catClass = 'tag-system';

          const pauseBtn = proc.isPaused
            ? \`<button class="btn btn-small btn-primary" onclick="resumeProc(\${proc.pid})">Resume</button>\`
            : \`<button class="btn btn-small" onclick="pauseProc(\${proc.pid})">Pause</button>\`;

          tr.innerHTML = \`
            <td>\${proc.pid}</td>
            <td style="color: var(--text-bright); font-weight: 500;">\${escapeHtml(proc.friendlyName)}</td>
            <td><span class="tag \${catClass}">\${escapeHtml(proc.category)}</span></td>
            <td>\${proc.cpu.toFixed(1)}%</td>
            <td style="font-weight: 600;">\${proc.rssMB} MB</td>
            <td>\${proc.isPaused ? '<span style="color:var(--accent-red)">PAUSED</span>' : '<span style="color:var(--accent-green)">RUNNING</span>'}</td>
            <td>
              <div style="display: flex; gap: 6px;">
                \${pauseBtn}
                <button class="btn btn-small" onclick="applyQoS(\${proc.pid})" title="Assign to Efficiency Cores">QoS-Eco</button>
                <button class="btn btn-small btn-danger" onclick="killProc(\${proc.pid})">Kill</button>
              </div>
            </td>
          \`;
          tbody.appendChild(tr);
        });
      }

      if (data.logs) {
        const logTerm = document.getElementById('log-terminal');
        logTerm.innerHTML = '';
        data.logs.slice(0, 50).forEach(log => {
          const line = document.createElement('div');
          line.className = 'log-line';
          const time = new Date(log.timestamp).toLocaleTimeString();
          let cls = '';
          if (log.type === 'success') cls = 'log-success';
          else if (log.type === 'action') cls = 'log-action';
          else if (log.type === 'warn') cls = 'log-warn';
          else if (log.type === 'error') cls = 'log-error';

          line.innerHTML = \`<span class="log-time">[\${time}]</span> <span class="\${cls}">\${escapeHtml(log.message)}</span>\`;
          logTerm.appendChild(line);
        });
      }
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function warmServer(name) {
      await fetch(\`/api/pool/\${name}/warm\`, { method: 'POST' });
      fetchData();
    }

    async function sleepServer(name) {
      await fetch(\`/api/pool/\${name}/sleep\`, { method: 'POST' });
      fetchData();
    }

    async function sleepAll() {
      await fetch('/api/pool/sleep-all', { method: 'POST' });
      fetchData();
    }

    async function runOptimize() {
      await fetch('/api/optimize', { method: 'POST' });
      fetchData();
    }

    async function pauseProc(pid) {
      await fetch(\`/api/process/\${pid}/pause\`, { method: 'POST' });
      fetchData();
    }

    async function resumeProc(pid) {
      await fetch(\`/api/process/\${pid}/resume\`, { method: 'POST' });
      fetchData();
    }

    async function applyQoS(pid) {
      await fetch(\`/api/process/\${pid}/qos\`, { method: 'POST' });
      fetchData();
    }

    async function killProc(pid) {
      if (confirm(\`Are you sure you want to stop PID \${pid}?\`)) {
        await fetch(\`/api/process/\${pid}/kill\`, { method: 'POST' });
        fetchData();
      }
    }

    fetchData();
    setInterval(fetchData, 2000);
  </script>
</body>
</html>`;
}
