---
name: system-diagnostics
description: Diagnose Windows system performance issues — check CPU, memory, zombie processes, and network port usage. For when user reports slowness, high CPU, or asks to find runaway processes.
---

# System Diagnostics

Diagnose Windows performance problems: high CPU, memory pressure, zombie processes, port conflicts.

## When to Use

- User says "电脑卡了", "CPU风扇一直转", "看看后台", "僵尸进程", "卡顿"
- User reports system slowdown or high resource usage
- Need to find what's using a specific port
- Pre-deployment check before starting services

## Procedure

### Step 1: Quick overview — top memory consumers

```powershell
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 20 Name, @{N='内存MB';E={[math]::Round($_.WorkingSet64/1MB,1)}}, @{N='CPU总时间';E={[math]::Round($_.TotalProcessorTime.TotalMinutes,1)}}, StartTime | Format-Table -AutoSize
```

### Step 2: Check CPU-intensive processes

```powershell
Get-Process | Where-Object {$_.CPU -gt 10} | Sort-Object CPU -Descending | Select-Object Name, Id, @{N='CPU秒';E={[math]::Round($_.CPU,1)}}, StartTime | Format-Table -AutoSize
```

### Step 3: Find zombie / orphaned Python/Node processes

```powershell
# Python processes
Get-Process python -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime, @{N='内存MB';E={[math]::Round($_.WorkingSet64/1MB,1)}}

# Node processes
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime, @{N='内存MB';E={[math]::Round($_.WorkingSet64/1MB,1)}}
```

### Step 4: Check what's listening on key ports

```powershell
# Check port 8000 (backend)
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess, State

# Check all listening ports
netstat -ano | findstr LISTENING
```

### Step 5: Check for proxy / VPN processes (if network issues)

```powershell
Get-Process -Name "*clash*","*v2ray*","*cfw*","*verge*","*flclash*" -ErrorAction SilentlyContinue | Select-Object ProcessName, Id, StartTime
```

### Step 6: Kill problematic processes (if needed)

**Specific port:**
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
```

**All Python (use with caution):**
```powershell
Stop-Process -Name python -Force -ErrorAction SilentlyContinue
```

**Specific PID:**
```powershell
Stop-Process -Id <PID> -Force
```

## Stopping Conditions

- ✅ Top processes identified and explained to user
- ✅ Root cause found (specific process, port conflict, etc.)
- ✅ Problematic processes killed if requested
- ✅ User confirms system feels normal again

## Notes

- This pattern was used across **5+ sessions** for system troubleshooting
- `Get-Process` was the most-used PowerShell command (151 times in 30 days)
- Always confirm before killing processes — explain what each does
- On this Windows machine, common heavy processes: Python (dev servers), Node.js, Docker, Blender
