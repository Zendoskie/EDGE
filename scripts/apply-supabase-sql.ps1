param(
  [Parameter(Mandatory = $true)]
  [string]$File,

  [string]$Ref,

  [switch]$NoHistory
)

# Applies one SQL file through the Supabase Management API (the same endpoint the
# dashboard SQL editor uses). Useful when `supabase db push` cannot initialise its
# CLI login role on the project:
#   ERROR: permission denied to alter role "cli_login_postgres"
#
# Auth: SUPABASE_ACCESS_TOKEN if set, otherwise the token stored by `supabase login`
# in Windows Credential Manager. The token is never printed.

$ErrorActionPreference = "Stop"

function Get-ManagementToken {
  if ($env:SUPABASE_ACCESS_TOKEN) {
    return $env:SUPABASE_ACCESS_TOKEN.Trim()
  }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class EdgeCred
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL
    {
        public UInt32 Flags;
        public UInt32 Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredFree")]
    public static extern void CredFree(IntPtr cred);

    public static string ReadSecret(string target)
    {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) return null;
        try
        {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            byte[] bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
            return System.Text.Encoding.UTF8.GetString(bytes).Trim('\0', ' ', '\r', '\n');
        }
        finally
        {
            CredFree(ptr);
        }
    }
}
"@

  $token = [EdgeCred]::ReadSecret("Supabase CLI:supabase")
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "No SUPABASE_ACCESS_TOKEN and no Supabase CLI token in Windows Credential Manager. Run 'supabase login' or set SUPABASE_ACCESS_TOKEN."
  }
  return $token
}

function Get-ProjectRef {
  if ($Ref) { return $Ref }

  $refFile = Join-Path $PSScriptRoot "..\supabase\.temp\project-ref"
  if (Test-Path $refFile) {
    $value = ([System.IO.File]::ReadAllText((Resolve-Path $refFile).Path)).Trim()
    if ($value) { return $value }
  }
  throw "Project ref not found. Pass -Ref <project-ref>."
}

function Invoke-SupabaseSql {
  param(
    [string]$Token,
    [string]$ProjectRef,
    [string]$Sql
  )

  $body = @{ query = $Sql } | ConvertTo-Json -Depth 5 -Compress

  try {
    return Invoke-RestMethod `
      -Method Post `
      -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/query" `
      -Headers @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" } `
      -Body $body `
      -TimeoutSec 300
  } catch {
    $detail = $_.ErrorDetails.Message
    if (-not $detail) { $detail = $_.Exception.Message }
    throw "Management API rejected the SQL: $detail"
  }
}

$fullPath = (Resolve-Path -LiteralPath $File).Path
$fileName = [System.IO.Path]::GetFileName($fullPath)
$sql = [System.IO.File]::ReadAllText($fullPath, [System.Text.Encoding]::UTF8)

$token = Get-ManagementToken
$projectRef = Get-ProjectRef

Write-Host "Applying $fileName to project $projectRef ..."

# One transaction; if any statement fails the database is left unchanged.
$result = Invoke-SupabaseSql -Token $token -ProjectRef $projectRef -Sql ("BEGIN;`n" + $sql + "`nCOMMIT;")

if ($null -ne $result) {
  $result | ConvertTo-Json -Depth 8
}

$match = [regex]::Match($fileName, '^(\d{14})_(.+)\.sql$')
if (-not $NoHistory -and $match.Success) {
  $version = $match.Groups[1].Value
  $name = $match.Groups[2].Value
  $safeName = $name.Replace("'", "''")

  $historySql = @"
INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
SELECT '$version', '$safeName', NULL, 'apply-supabase-sql'
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$version'
);
"@

  Invoke-SupabaseSql -Token $token -ProjectRef $projectRef -Sql $historySql | Out-Null
  Write-Host "Recorded migration $version ($name)."
}

Write-Host "Done."
