// Storyboard Studio — Azure infrastructure (plan D3).
//
// Container Apps + Postgres Flexible Server + Blob Storage + Key Vault.
// Container Apps scales to zero when idle, which suits a low-traffic creative tool.
//
//   az deployment group create -g <rg> -f infra/main.bicep -p @infra/params.dev.json

targetScope = 'resourceGroup'

@description('Short environment name, used in resource names. e.g. dev, prod')
@maxLength(10)
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Administrator login for Postgres.')
param dbAdminUser string = 'storyboard'

@secure()
@description('Administrator password for Postgres.')
param dbAdminPassword string

@secure()
@description('Signing secret for session tokens.')
param jwtSecret string

@secure()
@description('Anthropic API key for optional Claude scene thumbnails. Leave blank to disable.')
param anthropicApiKey string = ''

@description('Claude model used for scene thumbnail drawing instructions.')
param anthropicModel string = 'claude-sonnet-5'

@description('Container image for the API, including tag.')
param apiImage string

@description('Allowed browser origins, comma separated.')
param corsOrigins string

var prefix = 'sbs-${environmentName}'
var uniq = uniqueString(resourceGroup().id)

// ── Observability ───────────────────────────────────────────────────────────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── Identity: the API reaches Key Vault and Blob without stored credentials ──
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-id'
  location: location
}

// ── Storage for assets (NF-14: private, served via short-lived signed URLs) ──
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  // Storage account names are capped at 24 chars and must be lowercase alphanumeric,
  // so both variable parts are truncated rather than trusted to fit.
  name: toLower('sbs${take(environmentName, 6)}${take(uniq, 13)}')
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource assetsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'assets'
  properties: { publicAccess: 'None' }
}

// ── Secrets (NF-20) ─────────────────────────────────────────────────────────
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${prefix}-kv-${uniq}'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
  }
}

var keyVaultSecretsUserRole = '4633458b-17de-408a-b874-0445c86b69e6'
resource vaultAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, identity.id, keyVaultSecretsUserRole)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRole)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

var blobDataContributorRole = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
resource storageAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, identity.id, blobDataContributorRole)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRole)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Database ────────────────────────────────────────────────────────────────
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${prefix}-pg-${uniq}'
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: dbAdminUser
    administratorLoginPassword: dbAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      // NF-9: nightly automated backups, 30-day retention.
      backupRetentionDays: 30
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'storyboard'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Container Apps egress addresses are dynamic; the all-zero range is Azure's
// documented "allow Azure-internal services only" rule, not a public opening.
resource pgFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ── Compute ─────────────────────────────────────────────────────────────────
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-api'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3001
        transport: 'auto'
        // NF-12: TLS terminates at the ingress; plain HTTP is redirected.
        allowInsecure: false
      }
      secrets: [
        {
          name: 'database-url'
          value: 'postgres://${dbAdminUser}:${dbAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/storyboard?sslmode=require'
        }
        {
          name: 'jwt-secret'
          value: jwtSecret
        }
        {
          name: 'anthropic-api-key'
          value: anthropicApiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3001' }
            { name: 'CORS_ORIGINS', value: corsOrigins }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            { name: 'ANTHROPIC_MODEL', value: anthropicModel }
            { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
          ]
          probes: [
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3001
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        // Scaling to zero when idle is the reason Container Apps was chosen (D3).
        minReplicas: 0
        maxReplicas: 3
      }
    }
  }
  dependsOn: [
    database
    vaultAccess
    storageAccess
  ]
}

output apiUrl string = 'https://${api.properties.configuration.ingress.fqdn}'
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output storageAccountName string = storage.name
output keyVaultName string = vault.name
