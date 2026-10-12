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

$envExists = az containerapp env list -g $ResourceGroup --query "[?name=='$EnvName'] | length(@)" -o tsv
if ($envExists -eq "0") {
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

$appExists = az containerapp list -g $ResourceGroup --query "[?name=='$AppName'] | length(@)" -o tsv
if ($appExists -eq "0") {
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
foreach ($role in @("Azure AI User", "Cognitive Services Speech User")) {
  $has = az role assignment list --assignee $principal --scope $foundryId --role $role --query "length(@)" -o tsv
  if ($has -eq "0") {
    az role assignment create --role $role --assignee-object-id $principal --assignee-principal-type ServicePrincipal --scope $foundryId --only-show-errors | Out-Null
    Check "Assigning $role"
    Write-Host "Granted: $role"
  } else {
    Write-Host "Already has: $role"
  }
}

$fqdn = az containerapp show -n $AppName -g $ResourceGroup --query properties.configuration.ingress.fqdn -o tsv
Write-Host "`nDone. Your live site: https://$fqdn" -ForegroundColor Green
Write-Host "First deploy: role permissions can take about 5 minutes to apply. If commentary shows 'template' at first, wait, then run:"
Write-Host "  az containerapp revision restart -n $AppName -g $ResourceGroup --revision (az containerapp revision list -n $AppName -g $ResourceGroup --query '[0].name' -o tsv)"
