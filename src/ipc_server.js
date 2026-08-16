import net from 'node:net';
import fs from 'node:fs';

export class NodePoolIPCServer {
  constructor(poolManager, socketPath = '/tmp/nodepool.sock') {
    this.pool = poolManager;
    this.socketPath = socketPath;
    this.server = null;
  }

  start() {
    if (fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath); } catch (e) {}
    }

    this.server = net.createServer((socket) => {
      let instanceKey = null;
      let targetInstance = null;
      let initialized = false;
      let buffer = '';

      socket.on('data', async (chunk) => {
        if (!initialized) {
          buffer += chunk.toString();
          const newlineIdx = buffer.indexOf('\n');
          if (newlineIdx !== -1) {
            const firstLine = buffer.slice(0, newlineIdx).trim();
            const remainder = buffer.slice(newlineIdx + 1);

            const match = firstLine.match(/^INIT\s+(\S+)(?:\s+(.*))?$/);
            if (match) {
              const serverName = match[1];
              const rawArgs = match[2] ? match[2].trim().split(/\s+/) : [];
              initialized = true;

              try {
                targetInstance = await this.pool.acquireServer(serverName, rawArgs);
                instanceKey = targetInstance.name;
                this.pool.emit('log', `Client connected to pool server '${instanceKey}'`, 'action');

                if (remainder.length > 0) {
                  targetInstance.process.stdin.write(remainder);
                }

                const onData = (data) => {
                  if (!socket.destroyed) {
                    socket.write(data);
                  }
                };

                targetInstance.process.stdout.on('data', onData);

                socket.on('close', () => {
                  if (targetInstance && targetInstance.process && targetInstance.process.stdout) {
                    targetInstance.process.stdout.removeListener('data', onData);
                  }
                  if (instanceKey) this.pool.touchServer(instanceKey);
                });
              } catch (err) {
                socket.write(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null }) + '\n');
                socket.end();
              }
            }
          }
        } else {
          if (targetInstance && targetInstance.process && !targetInstance.process.stdin.destroyed) {
            targetInstance.process.stdin.write(chunk);
            if (instanceKey) this.pool.touchServer(instanceKey);
          }
        }
      });

      socket.on('error', () => {
        if (instanceKey) this.pool.touchServer(instanceKey);
      });
    });

    this.server.listen(this.socketPath, () => {
      this.pool.emit('log', `NodePool IPC socket listening at ${this.socketPath}`, 'start');
    });

    try { fs.chmodSync(this.socketPath, 0o777); } catch (e) {}
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath); } catch (e) {}
    }
  }
}
