# Deploys Matchday Crew to Azure Container Apps.
#
# Prerequisites
#   1. az login (already done)
#   2. The GitHub Action has published the image, and the package is public:
#      github.com/timsheldon1?tab=packages > matchday-crew > Package settings > Change visibility > Public
#
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File deploy\azure-deploy.ps1
#
# Safe to run again: it updates the existing app to the latest image.

param(
  [string]$ResourceGroup = "rg-timsheldonoure1-7401",
  [string]$FoundryResource = "timsheldonoure1-7020-resource",
  [string]$FoundryProject = "timsheldonoure1-7020",
  [string]$Deployment = "matchday-mini",
  [string]$AppName = "matchday-crew",
  [string]$EnvName = "matchday-env",
  [string]$Image = "ghcr.io/timsheldon1/matchday-crew:latest"
)

$ErrorActionPreference = "Stop"
function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" } }

Step "Reading your Foundry resource"
$location = az cognitiveservices account show -n $FoundryResource -g $ResourceGroup --query location -o tsv; Check "Reading the Foundry resource"
$foundryId = az cognitiveservices account show -n $FoundryResource -g $ResourceGroup --query id -o tsv
$endpoint = "https://$FoundryResource.services.ai.azure.com/api/projects/$FoundryProject"
Write-Host "Region: $location"

Step "Preparing Azure Container Apps (first run takes a few minutes)"
az extension add --name containerapp --upgrade --yes --only-show-errors
az provider register --namespace Microsoft.App --wait; Check "Registering Microsoft.App"
az provider register --namespace Microsoft.OperationalInsights --wait; Check "Registering Microsoft.OperationalInsights"

# Note: no pipes or parentheses inside --query; Windows passes az arguments through cmd.exe, which breaks them.
$envNames = @(az containerapp env list -g $ResourceGroup --query "[].name" -o tsv)
if ($envNames -notcontains $EnvName) {
  Step "Creating the Container Apps environment"
  az containerapp env create -n $EnvName -g $ResourceGroup -l $location --only-show-errors; Check "Creating the environment"
}

$envVars = @(
  "FOUNDRY_PROJECT_ENDPOINT=$endpoint",
  "FOUNDRY_MODEL_DEPLOYMENT=$Deployment",
  "MATCHDAY_AGENT_MODE=agent",
  "SPEECH_REGION=$location",
  "SPEECH_RESOURCE_ID=$foundryId",
  "MAX_CREW_STREAMS=4"
)

$appNames = @(az containerapp list -g $ResourceGroup --query "[].name" -o tsv)
if ($appNames -notcontains $AppName) {
  Step "Creating the Container App"
  az containerapp create -n $AppName -g $ResourceGroup --environment $EnvName `
    --image $Image --target-port 4000 --ingress external `
    --cpu 0.5 --memory 1.0Gi --min-replicas 0 --max-replicas 2 `
    --system-assigned --env-vars $envVars --only-show-errors | Out-Null
  Check "Creating the Container App"
} else {
  Step "Updating the Container App to the latest image"
  az containerapp update -n $AppName -g $ResourceGroup --image $Image --set-env-vars $envVars `
    --revision-suffix ("r" + (Get-Date -Format "MMddHHmm")) --only-show-errors | Out-Null
  Check "Updating the Container App"
}

Step "Giving the app's managed identity access to Foundry and Speech"
$principal = az containerapp show -n $AppName -g $ResourceGroup --query identity.principalId -o tsv
# Roles are assigned by their fixed built-in IDs: looking them up by name failed on some setups.
#   Cognitive Services User (required): data access to the models, agents and Speech on this resource
#   Azure AI User and Cognitive Services Speech User: narrower Foundry and Speech roles, added when available
$roles = @(
  @{ Name = "Cognitive Services User"; Id = "a97b65f3-24c7-4388-baec-2e87135dc908"; Required = $true },
  @{ Name = "Azure AI User"; Id = "53ca6127-db72-4b80-b1b0-d745d6d5456d"; Required = $false },
  @{ Name = "Cognitive Services Speech User"; Id = "f2dc8367-1007-4938-bd23-fe263f013447"; Required = $false }
)
$existingRoleIds = @(az role assignment list --assignee $principal --scope $foundryId --query "[].roleDefinitionId" -o tsv) -join " "
foreach ($r in $roles) {
  if ($existingRoleIds -like "*$($r.Id)*") { Write-Host "Already has: $($r.Name)"; continue }
  az role assignment create --role $r.Id --assignee-object-id $principal --assignee-principal-type ServicePrincipal --scope $foundryId --only-show-errors | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host "Granted: $($r.Name)" }
  elseif ($r.Required) { throw "Assigning $($r.Name) failed" }
  else { Write-Host "Skipped: $($r.Name) (not available here; Cognitive Services User covers it)" -ForegroundColor Yellow }
}

$fqdn = az containerapp show -n $AppName -g $ResourceGroup --query properties.configuration.ingress.fqdn -o tsv
Write-Host "`nDone. Your live site: https://$fqdn" -ForegroundColor Green
Write-Host "First deploy: role permissions can take about 5 minutes to apply. If commentary shows 'template' at first, wait, then run:"
Write-Host "  az containerapp revision restart -n $AppName -g $ResourceGroup --revision (az containerapp revision list -n $AppName -g $ResourceGroup --query '[0].name' -o tsv)"
