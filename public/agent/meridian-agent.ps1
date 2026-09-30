<#
  Meridian RMM Windows agent
  Install (elevated PowerShell):
    .\meridian-agent.ps1 -Install -Server https://your-app-url -EnrollmentKey <key>
  Monitoring/check-in/queued-script bootstrap agent: runs every minute as SYSTEM
  via a scheduled task, reports health and runs queued scripts. Not a remote desktop
  or VNC agent; that will require a native Windows service, an interactive user-session
  helper and outbound signaling/relay instead of inbound VNC ports.
#>
param(
  [switch]$Install,
  [switch]$Uninstall,
  [string]$Server,
  [string]$EnrollmentKey
)

$ErrorActionPreference = 'Stop'
$AgentVersion = '1.0.0'
$Dir = Join-Path $env:ProgramData 'Meridian'
$ConfigPath = Join-Path $Dir 'agent.json'
$AgentPath = Join-Path $Dir 'meridian-agent.ps1'
$TaskName = 'Meridian RMM Agent'
$LogPath = Join-Path $Dir 'agent.log'

function Log($msg) {
  "$(Get-Date -Format s) $msg" | Out-File -FilePath $LogPath -Append -Encoding utf8
}

function Get-HardwareId {
  try { (Get-CimInstance Win32_ComputerSystemProduct).UUID } catch { $env:COMPUTERNAME }
}

function Get-PrimaryIp {
  try {
    (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress
  } catch { $null }
}

function Get-DeviceType {
  $os = Get-CimInstance Win32_OperatingSystem
  if ($os.ProductType -ne 1) { return 'server' }
  $enc = Get-CimInstance Win32_SystemEnclosure -ErrorAction SilentlyContinue
  if ($enc -and ($enc.ChassisTypes | Where-Object { $_ -in 8,9,10,14,30,31,32 })) { return 'laptop' }
  'workstation'
}

function Get-PendingPatches {
  try {
    $session = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    $searcher.Online = $false
    ($searcher.Search("IsInstalled=0 and IsHidden=0")).Updates.Count
  } catch { 0 }
}

function Invoke-Api($path, $body, $token) {
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($token) { $headers['Authorization'] = "Bearer $token" }
  Invoke-RestMethod -Method Post -Uri ($script:Cfg.server.TrimEnd('/') + $path) -Headers $headers -Body ($body | ConvertTo-Json -Depth 5 -Compress) -TimeoutSec 60
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Meridian agent removed.'
  exit 0
}

if ($Install) {
  if (-not $Server -or -not $EnrollmentKey) { throw 'Install requires -Server and -EnrollmentKey' }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Copy-Item -Path $PSCommandPath -Destination $AgentPath -Force
  $script:Cfg = [pscustomobject]@{ server = $Server }
  $os = Get-CimInstance Win32_OperatingSystem
  $res = Invoke-Api '/api/public/agent/enroll' @{
    enrollment_key = $EnrollmentKey
    hostname       = $env:COMPUTERNAME
    os             = "$($os.Caption) $($os.Version)"
    device_type    = Get-DeviceType
    ip_address     = Get-PrimaryIp
    external_id    = Get-HardwareId
  } $null
  @{ server = $Server; device_id = $res.device_id; token = $res.token } | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding utf8
  # Lock config to SYSTEM and Administrators
  icacls $Dir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null

  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AgentPath`""
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host "Enrolled as device $($res.device_id). Agent runs every minute."
  exit 0
}

# ---- Check-in run ----
try {
  $script:Cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  $os = Get-CimInstance Win32_OperatingSystem
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  $mem = [math]::Round((1 - $os.FreePhysicalMemory / $os.TotalVisibleMemorySize) * 100, 1)
  $sys = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
  $disk = [math]::Round((1 - $sys.FreeSpace / $sys.Size) * 100, 1)

  # Patch scan is slow; do it at most hourly and cache the result.
  $patchCache = Join-Path $Dir 'patches.txt'
  if (-not (Test-Path $patchCache) -or ((Get-Date) - (Get-Item $patchCache).LastWriteTime).TotalMinutes -gt 60) {
    (Get-PendingPatches) | Set-Content $patchCache
  }
  $patches = [int](Get-Content $patchCache)

  $res = Invoke-Api '/api/public/agent/checkin' @{
    cpu_percent     = [double]$cpu
    memory_percent  = [double]$mem
    disk_percent    = [double]$disk
    patches_pending = $patches
    ip_address      = Get-PrimaryIp
    os              = "$($os.Caption) $($os.Version)"
    uptime_seconds  = [int64]((Get-Date) - $os.LastBootUpTime).TotalSeconds
    agent_version   = $AgentVersion
  } $script:Cfg.token

  foreach ($job in $res.jobs) {
    Log "Running script $($job.script_name) ($($job.id))"
    $tmp = Join-Path $Dir "job-$($job.id).ps1"
    Set-Content -Path $tmp -Value $job.body -Encoding utf8
    $code = 0
    try {
      $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp 2>&1 | Out-String
      $code = $LASTEXITCODE; if ($null -eq $code) { $code = 0 }
    } catch { $out = $_ | Out-String; $code = 1 }
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    if ($out.Length -gt 190000) { $out = $out.Substring($out.Length - 190000) }
    Invoke-Api '/api/public/agent/result' @{ run_id = $job.id; exit_code = [int]$code; output = $out } $script:Cfg.token | Out-Null
  }
} catch {
  Log "Error: $_"
}
