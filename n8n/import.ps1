param(
    [string]$Container = 'n8n'
)

$ErrorActionPreference = 'Stop'

$workflowsDir = Join-Path $PSScriptRoot "workflows"
$workflowFiles = Get-ChildItem -Path $workflowsDir -Filter "*.json"

if ($workflowFiles.Count -eq 0) {
    Write-Warning "No workflow JSON files found in $workflowsDir"
    exit 0
}

Write-Host "Importing workflows into container '$Container'..."

foreach ($file in $workflowFiles) {
    $containerTmpPath = "/tmp/$($file.Name)"
    Write-Host "Importing $($file.Name)..."
    docker cp $file.FullName "$($Container):$containerTmpPath"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to copy '$($file.Name)' into container '$Container' (exit code $LASTEXITCODE)"
    }
    try {
        docker exec $Container n8n import:workflow --input=$containerTmpPath
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to import '$($file.Name)' into container '$Container' (exit code $LASTEXITCODE)"
        }
    }
    finally {
        docker exec $Container rm -f $containerTmpPath
    }
}

Write-Host "All workflows imported successfully."
