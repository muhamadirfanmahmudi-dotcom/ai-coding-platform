---
name: restart-server
description: Kill a process on a specific port and restart the associated server with health check verification. Commonly used for Python uvicorn/Flask backends on Windows.
---

# Restart Server

Kill the process occupying a port, restart the backend service, and verify it's healthy.

## When to Use

- Server is unresponsive or needs a code change applied
- User says "restart", "重新启动", "打开测试", "server down"
- Port conflict detected after editing backend code

## Prerequisites

- Target port number (default: 8000 for decisions backend)
-知道要启动什么服务（uvicorn、node 等）

## Procedure

### Step 1: Kill existing process on the port

**PowerShell (port 8000):**
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) -ErrorAction SilentlyContinue | Stop-Process -Force
```

**Or for any port (parameterized):**
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

Wait 2-3 seconds after killing.

### Step 2: Start the server

**Python uvicorn (decisions project):**
```powershell
Set-Location "E:\decisions"
Start-Process -NoNewWindow -FilePath "python" -ArgumentList "-m uvicorn backend.main:app --host 0.0.0.0 --port 8000"
```

**Or via Bash (MSYS2):**
```bash
PYTHONPATH=/e/decisions python -m uvicorn main:app --host 0.0.0.0 --port 8000 > /e/decisions/backend/server.log 2>&1 &
```

### Step 3: Health check (wait 3-5 seconds, then verify)

```powershell
Start-Sleep -Seconds 4
try {
    $r = Invoke-WebRequest -Uri 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 5
    Write-Output "Server OK: $($r.StatusCode)"
} catch {
    Write-Output "Server FAILED: $_"
}
```

Or via curl:
```bash
sleep 3 && curl -s http://localhost:8000/api/health
```

### Step 4: If health check fails

1. Check server logs: `Get-Content E:\decisions\backend\server.log -Tail 20`
2. Verify port is listening: `netstat -ano | findstr :8000`
3. Check for Python errors in the log output
4. Fix and retry from Step 1

## Stopping Conditions

- ✅ Health endpoint returns HTTP 200 with `{"status": "ok"}` or similar
- ✅ Process confirmed running: `Get-Process -Name python` shows new PID
- ❌ If port still occupied after kill, try `Stop-Process -Name python -Force`

## Notes

- This pattern was used **9+ times** across the `E:\decisions` project sessions
- Always wait between kill and restart to avoid port race conditions
- On Windows, `Stop-Process -Name python -Force` kills ALL Python processes — use port-based targeting when possible
- For the decisions project, the venv is at `E:\decisions\.venv\Scripts\python`
