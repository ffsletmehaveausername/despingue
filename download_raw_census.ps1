$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$key = $env:CENSUS_API_KEY
if (-not $key) {
    $keyFile = Join-Path $root 'CensusAPIKey.txt'
    if (-not (Test-Path -LiteralPath $keyFile)) { throw 'Set CENSUS_API_KEY or create CensusAPIKey.txt beside this script.' }
    $key = Get-Content -LiteralPath $keyFile -Raw
}
$key = $key.Trim()
if ($key -match ':') { $key = ($key -split ':', 2)[1].Trim() }
if (-not $key) { throw 'Census API key file is empty.' }

$output = Join-Path $root 'raw_downloads'
$tables = @(
    'B01001', 'B01002', 'B01003', 'B03001', 'B09001',
    'B15003', 'B18101', 'B19001', 'B19013', 'B19057',
    'B19058', 'B19301', 'B23025', 'B25001', 'B25002',
    'B25003', 'B25077'
)

function Save-OriginalResponse($url, $destination, $firstByte) {
    if (Test-Path -LiteralPath $destination) {
        $existing = [System.IO.File]::OpenRead($destination)
        try { $valid = $existing.Length -gt 100 -and $existing.ReadByte() -eq $firstByte }
        finally { $existing.Dispose() }
        if ($valid) { return }
        throw "Existing download is invalid: $destination"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    try {
        Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing -TimeoutSec 180 -ErrorAction Stop | Out-Null
        $file = [System.IO.File]::OpenRead($destination)
        try { $valid = $file.Length -gt 100 -and $file.ReadByte() -eq $firstByte }
        finally { $file.Dispose() }
        if (-not $valid) { throw 'Unexpected response format' }
    }
    catch {
        Remove-Item -LiteralPath $destination -ErrorAction SilentlyContinue
        throw "Download failed or response was not raw Census data: $destination (key and URL omitted)"
    }
}

$encodedKey = [uri]::EscapeDataString($key)
foreach ($year in 2016, 2020, 2024) {
    foreach ($table in $tables) {
        $endpoint = "https://api.census.gov/data/$year/acs/acs5"
        $query = "?get=group%28$table%29&for=block%20group%3A%2A&in=state%3A72%20county%3A%2A&key=$encodedKey"
        Save-OriginalResponse ($endpoint + $query) (Join-Path $output "acs5\$year\$table.json") 91
        Write-Output "ACS $year $table saved"
    }
}

$endpoint = 'https://api.census.gov/data/2020/dec/pl'
$query = "?get=NAME%2CP1_001N&for=block%3A%2A&in=state%3A72%20county%3A%2A&key=$encodedKey"
Save-OriginalResponse ($endpoint + $query) (Join-Path $output 'decennial_2020\P1_001N_blocks.json') 91
Write-Output '2020 decennial block population saved'

$tiger = 'https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_72_tabblock20.zip'
Save-OriginalResponse $tiger (Join-Path $output 'tiger2020\tl_2020_72_tabblock20.zip') 80
Write-Output '2020 TIGER block geometry ZIP saved'