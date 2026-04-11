#Requires -Version 5.1
<#
.SYNOPSIS
  HSEOS Project State CLI (PowerShell)
.DESCRIPTION
  Manages STATE.md and TASKS.md via SQLite using PSSQLite module.
  Install module with: Install-Module -Name PSSQLite -Scope CurrentUser
.EXAMPLE
  .\project-state.ps1 state read
  .\project-state.ps1 state write -Key branch -Value feature/my-feature
  .\project-state.ps1 tasks list
  .\project-state.ps1 tasks list -Status pending
  .\project-state.ps1 tasks add -Id T5 -Owner GHOST -Desc "Implement auth"
  .\project-state.ps1 tasks done -Id T5
  .\project-state.ps1 tasks block -Id T6 -Reason "Waiting on T5"
  .\project-state.ps1 history -N 10
#>

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('state', 'tasks', 'history')]
  [string]$Command,

  [Parameter(Position = 1)]
  [string]$SubCommand,

  [string]$Key,
  [string]$Value,
  [string]$Status,
  [string]$Id,
  [string]$Owner,
  [string]$Desc,
  [string]$Reason,
  [string]$Agent = 'powershell-cli',
  [int]$N = 20
)

$DbPath = if ($env:HSEOS_STATE_DB) { $env:HSEOS_STATE_DB } else { '.hseos\state\project.db' }

function Assert-PSSQLite {
  if (-not (Get-Module -ListAvailable -Name PSSQLite)) {
    Write-Error "[project-state] PSSQLite module not found. Install with: Install-Module -Name PSSQLite -Scope CurrentUser"
    exit 1
  }
  Import-Module PSSQLite -ErrorAction Stop
}

function Initialize-Db {
  $dir = Split-Path -Parent $DbPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  $ddl = @"
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  depends_on TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS state_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"@
  Invoke-SqliteQuery -DataSource $DbPath -Query $ddl
}

switch ($Command) {
  'state' {
    Assert-PSSQLite
    Initialize-Db

    switch ($SubCommand) {
      'read' {
        Invoke-SqliteQuery -DataSource $DbPath -Query "SELECT key, value, updated_at FROM state ORDER BY key" | Format-Table
      }
      'write' {
        if (-not $Key -or -not $Value) { Write-Error "Requires -Key and -Value"; exit 1 }
        Invoke-SqliteQuery -DataSource $DbPath -Query @"
INSERT INTO state (key, value, updated_at) VALUES (@key, @value, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
INSERT INTO state_history (key, old_value, new_value, changed_by)
  SELECT @key, (SELECT value FROM state WHERE key=@key), @value, @agent;
"@ -SqlParameters @{ key = $Key; value = $Value; agent = $Agent }
        Write-Host "[project-state] state.$Key = $Value"
      }
      default { Write-Error "SubCommand must be read or write"; exit 1 }
    }
  }

  'tasks' {
    Assert-PSSQLite
    Initialize-Db

    switch ($SubCommand) {
      'list' {
        $q = if ($Status) {
          Invoke-SqliteQuery -DataSource $DbPath -Query "SELECT id, owner, status, description FROM tasks WHERE status=@s ORDER BY created_at" -SqlParameters @{ s = $Status }
        } else {
          Invoke-SqliteQuery -DataSource $DbPath -Query "SELECT id, owner, status, description FROM tasks ORDER BY status, created_at"
        }
        $q | Format-Table
      }
      'add' {
        if (-not $Id -or -not $Owner -or -not $Desc) { Write-Error "Requires -Id, -Owner, -Desc"; exit 1 }
        Invoke-SqliteQuery -DataSource $DbPath -Query "INSERT OR IGNORE INTO tasks (id, owner, description) VALUES (@id, @owner, @desc)" `
          -SqlParameters @{ id = $Id; owner = $Owner; desc = $Desc }
        Write-Host "[project-state] task $Id added (owner: $Owner)"
      }
      'done' {
        if (-not $Id) { Write-Error "Requires -Id"; exit 1 }
        Invoke-SqliteQuery -DataSource $DbPath -Query "UPDATE tasks SET status='done', updated_at=datetime('now') WHERE id=@id" -SqlParameters @{ id = $Id }
        Write-Host "[project-state] task $Id marked done"
      }
      'block' {
        if (-not $Id) { Write-Error "Requires -Id"; exit 1 }
        Invoke-SqliteQuery -DataSource $DbPath -Query "UPDATE tasks SET status='blocked', note=@note, updated_at=datetime('now') WHERE id=@id" `
          -SqlParameters @{ id = $Id; note = $Reason }
        Write-Host "[project-state] task $Id blocked: $Reason"
      }
      default { Write-Error "SubCommand must be list, add, done, or block"; exit 1 }
    }
  }

  'history' {
    Assert-PSSQLite
    Initialize-Db
    Invoke-SqliteQuery -DataSource $DbPath -Query "SELECT key, old_value, new_value, changed_by, changed_at FROM state_history ORDER BY changed_at DESC LIMIT @n" `
      -SqlParameters @{ n = $N } | Format-Table
  }
}
