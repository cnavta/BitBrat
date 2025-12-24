import fs from 'fs';
import path from 'path';
import { loadArchitecture } from '../config/loader';

export type CdktfModule = 'network' | 'load-balancer' | 'connectors' | 'buckets';

export interface SynthOptions {
  rootDir: string;
  outDir?: string;
  env?: string;
  projectId?: string;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFileIfChanged(filePath: string, content: string) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) return;
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

export function getModuleOutDir(rootDir: string, moduleName: CdktfModule): string {
  return path.join(rootDir, 'infrastructure', 'cdktf', 'out', moduleName);
}

function synthNetworkTf(rootDir: string, env: string | undefined, projectId: string | undefined): string {
  // Read architecture.yaml overlays for network inputs; fall back to deployment defaults
  let defaultRegion = 'us-central1';
  let network: any = {};
  try {
    const arch = loadArchitecture(rootDir) as any;
    defaultRegion = arch?.deploymentDefaults?.region || arch?.defaults?.services?.region || defaultRegion;
    network = arch?.network || {};
  } catch {}
  const environment = env || 'dev';
  const project = projectId || 'placeholder-project';

  const regions: string[] = Array.isArray(network?.regions) && network.regions.length > 0 ? network.regions : [defaultRegion];
  const subnets: Record<string, { name?: string; cidr?: string }> = network?.subnets || {};
  const enableFlowLogs: boolean = !!network?.enableFlowLogs;
  const remoteState: { bucket?: string; prefix?: string } = network?.remoteState || {};

  const vpcName = 'brat-vpc';

  // Backend: prefer overlay remoteState when provided; disable in CI to keep plan-only safe
  const ci = String(process.env.CI || '').toLowerCase();
  const includeBackend = !!(remoteState.bucket && remoteState.prefix) && ci !== 'true' && ci !== '1';
  const backendBlock = includeBackend
    ? `  backend "gcs" {\n    bucket = "${remoteState.bucket}"\n    prefix = "${remoteState.prefix}"\n  }\n`
    : '';

  // Build locals for regions and subnets
  const regionsList = regions.map(r => `"${r}"`).join(', ');
  const subnetsMap = regions.map(r => {
    const sn = subnets[r] || {} as any;
    const name = sn.name || `brat-subnet-${r}-${environment}`;
    const cidr = sn.cidr || '10.10.0.0/20';
    return `    \"${r}\" = { name = \"${name}\", cidr = \"${cidr}\" }`;
  }).join(',\n');

  const flowLogsBlock = enableFlowLogs
    ? `\n  log_config {\n    aggregation_interval = \"INTERVAL_5_MIN\"\n    flow_sampling        = 0.5\n    metadata             = \"INCLUDE_ALL\"\n  }\n`
    : '';

  const tf = `# Synthesized by brat CDKTF synth (module: network)
# This file was generated to provision the BitBrat Network using overlays.
# module: network

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
  }
${backendBlock}}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type    = string
  default = "${project}"
}

variable "region" {
  type    = string
  default = "${regions[0]}"
}

variable "environment" {
  type    = string
  default = "${environment}"
}

locals {
  regions = [${regionsList}]
  subnets = {
${subnetsMap}
  }
}

# VPC
resource "google_compute_network" "vpc" {
  name                    = "${vpcName}"
  auto_create_subnetworks = false
}

# Subnets with Private Google Access (per region)
resource "google_compute_subnetwork" "subnet" {
  for_each                 = local.subnets
  name                     = each.value.name
  ip_cidr_range            = each.value.cidr
  region                   = each.key
  network                  = google_compute_network.vpc.id
  private_ip_google_access = true
${flowLogsBlock}}

# Proxy-only subnet for Regional Internal Application Load Balancer
resource "google_compute_subnetwork" "proxy_only_subnet" {
  for_each      = toset(local.regions)
  name          = "brat-proxy-only-subnet-${'${'}each.key}"
  ip_cidr_range = "10.129.0.0/23"
  purpose       = "REGIONAL_MANAGED_PROXY"
  role          = "ACTIVE"
  region        = each.key
  network       = google_compute_network.vpc.id
}

# Private DNS Zone: bitbrat.internal
resource "google_dns_managed_zone" "internal_zone" {
  name        = "bitbrat-internal"
  dns_name    = "bitbrat.internal."
  description = "Internal DNS zone for BitBrat VPC"
  visibility  = "private"
  private_visibility_config {
    networks {
      network_url = google_compute_network.vpc.self_link
    }
  }
}

# Private DNS Zone: bitbrat.local
resource "google_dns_managed_zone" "local_zone" {
  name        = "bitbrat-local"
  dns_name    = "bitbrat.local."
  description = "Internal DNS zone for service discovery"
  visibility  = "private"
  private_visibility_config {
    networks {
      network_url = google_compute_network.vpc.self_link
    }
  }
}

# Cloud Routers (per region)
resource "google_compute_router" "router" {
  for_each = toset(local.regions)
  name     = "brat-router-${'${'}each.key}"
  region   = each.key
  network  = google_compute_network.vpc.id
}

## Cloud NAT removed to reduce latency. Public egress should use Cloud Run default path.
## When using Serverless VPC Access, set egress to "Private ranges only" so public
## traffic (e.g., Pub/Sub APIs) bypasses the connector.

# Firewall: allow-internal
resource "google_compute_firewall" "allow_internal" {
  name    = "allow-internal"
  network = google_compute_network.vpc.name
  allow {
    protocol = "icmp"
  }
  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }
  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }
  source_ranges = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
  ]
}

# Firewall: allow-health-checks
resource "google_compute_firewall" "allow_health_checks" {
  name    = "allow-health-checks"
  network = google_compute_network.vpc.name
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  source_ranges = [
    "35.191.0.0/16",
    "130.211.0.0/22",
  ]
}

# Outputs for downstream stacks
output "vpcSelfLink" {
  description = "Self link for the created VPC"
  value       = google_compute_network.vpc.self_link
}

output "subnetSelfLinkByRegion" {
  description = "Map of region to subnet selfLink"
  value       = { for r, s in google_compute_subnetwork.subnet : r => s.self_link }
}

output "routersByRegion" {
  description = "Map of region to router name"
  value       = { for r, s in google_compute_router.router : r => s.name }
}

output "internalDnsZoneName" {
  value = google_dns_managed_zone.internal_zone.name
}

output "localDnsZoneName" {
  value = google_dns_managed_zone.local_zone.name
}

## NAT outputs removed
`;
  return tf;
}

function synthLoadBalancerTf(rootDir: string, env: string | undefined, projectId: string | undefined): string {
  let defaultRegion = 'us-central1';
  let arch: any = {};
  let lb: any = undefined;
  try {
    arch = loadArchitecture(rootDir) as any;
    defaultRegion = arch?.deploymentDefaults?.region || arch?.defaults?.services?.region || defaultRegion;
    lb = arch?.lb;
  } catch {}

  const environment = env || 'dev';
  const project = projectId || 'placeholder-project';
  const isProd = environment === 'prod';

  // Backend state in CI guarded like other modules
  const backendBucket = process.env.BITBRAT_TF_BACKEND_BUCKET;
  const ci = String(process.env.CI || '').toLowerCase();
  const includeBackend = !!backendBucket && ci !== 'true' && ci !== '1';
  const backendBlock = includeBackend
    ? `  backend "gcs" {\n    bucket = "${backendBucket}"\n    prefix = "lb/${environment}"\n  }\n`
    : '';

  // Compose Terraform blocks
  let resources: string[] = [];
  let datas: string[] = [];
  let negNames = new Set<string>();
  let beNames: string[] = [];
  let dnsRecords: string[] = [];
  let outputIpMappings: string[] = [];

  const servicesActiveMap: Record<string, any> = arch?.services || {};

  const lbResources = Object.entries(arch?.infrastructure?.resources || {})
    .filter(([_, r]: [string, any]) => r && r.type === 'load-balancer')
    .map(([key, r]) => ({ key, cfg: r as any }));

  // Fallback to deprecated lb.services[] only when no routing-driven resources provided
  if (lbResources.length === 0 && lb) {
    lbResources.push({ key: 'main-load-balancer', cfg: { ...lb, implementation: 'global-external-application-lb' } });
  }

  for (const { key: lbKey, cfg: lbNode } of lbResources) {
    const impl = lbNode.implementation || 'global-external-application-lb';
    const isInternal = impl === 'regional-internal-application-lb';
    const region = lbNode.region || defaultRegion;
    const routing = lbNode.routing;
    const defaultDomain = routing?.default_domain || (isInternal ? 'bitbrat.local' : 'api.bitbrat.ai');

    // IP selection
    const ipMode: 'create' | 'use-existing' = lbNode.ipMode || (isInternal ? 'create' : 'use-existing');
    const ipName = lbNode.ip || (isInternal ? `bitbrat-internal-ip-${environment}` : (environment === 'dev' ? 'birtrat-ip' : 'bitbrat-global-ip'));
    const useIpResource = isInternal || (!isProd && ipMode === 'create');
    
    const ipRefExpr = useIpResource
      ? `google_compute_${isInternal ? '' : 'global_'}address.${lbKey}_ip.address`
      : `data.google_compute_${isInternal ? '' : 'global_'}address.${lbKey}_ip.address`;

    if (useIpResource) {
      if (isInternal) {
        resources.push(`resource "google_compute_address" "${lbKey}_ip" {\n  name         = "${ipName}"\n  subnetwork   = "brat-subnet-${region}-${environment}"\n  address_type = "INTERNAL"\n  region       = "${region}"\n}`);
      } else {
        resources.push(`resource "google_compute_global_address" "${lbKey}_ip" {\n  name = "${ipName}"\n}`);
      }
    } else {
      if (isInternal) {
        datas.push(`data "google_compute_address" "${lbKey}_ip" {\n  name   = "${ipName}"\n  region = "${region}"\n}`);
      } else {
        datas.push(`data "google_compute_global_address" "${lbKey}_ip" {\n  name = "${ipName}"\n}`);
      }
    }
    outputIpMappings.push(`    ${JSON.stringify(lbKey)} = ${ipRefExpr}`);

    // Certificate selection (Only for external)
    let certRefExpr = '';
    if (!isInternal) {
      const certMode: 'managed' | 'use-existing' = lbNode.certMode || 'use-existing';
      const certRefRaw: string | undefined = lbNode.cert || (environment === 'dev' ? 'bitbrat-dev-cert' : `bitbrat-cert-${environment}`);
      const certName = certRefRaw ? String(certRefRaw).split('/').slice(-1)[0] : `bitbrat-cert-${environment}`;
      const useManagedCertResource = certMode === 'managed';
      if (useManagedCertResource) {
        resources.push(`resource "google_compute_managed_ssl_certificate" "${lbKey}_cert" {\n  name = "${certName}"\n  managed {\n    domains = ["${defaultDomain}"]\n  }\n}`);
        certRefExpr = `google_compute_managed_ssl_certificate.${lbKey}_cert.self_link`;
      } else {
        datas.push(`data "google_compute_ssl_certificate" "${lbKey}_cert" {\n  name = "${certName}"\n}`);
        certRefExpr = `data.google_compute_ssl_certificate.${lbKey}_cert.self_link`;
      }
    }

    // ROUTING-DRIVEN DERIVATION
    const deriveUniqueServices = (): string[] => {
      if (!routing || !Array.isArray(routing?.rules)) return [];
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const r of routing.rules as Array<any>) {
        const svc = r?.service;
        if (!svc || typeof svc !== 'string') continue;
        if (!seen.has(svc)) {
          seen.add(svc);
          ordered.push(svc);
        }
      }
      return ordered.filter((sid) => {
        const node = servicesActiveMap?.[sid];
        const active = !!(node && (node.active === true || node === true || typeof node === 'object'));
        return active;
      });
    };

    const referencedServices = deriveUniqueServices();
    const hasBucketRouting = !!(routing?.default_bucket) || !!(Array.isArray(routing?.rules) && routing.rules.some((r: any) => !!r?.bucket));

    type LegacySvc = { name: string; regions?: string[]; runService?: { name: string; projectId?: string } };
    const legacyServices: LegacySvc[] = (!routing && lbKey === 'main-load-balancer' && Array.isArray(lb?.services)) ? lb.services as LegacySvc[] : [];

    const usedRegions = new Set<string>();

    // Build service backends/NEGs
    const servicesToProcess = routing ? referencedServices : legacyServices.map(s => s.name);
    for (const sid of servicesToProcess) {
      const svcRegions = (routing || isInternal) ? [region] : (legacyServices.find(s => s.name === sid)?.regions || [region]);
      const beName = `be-${sid}-${isInternal ? 'internal' : 'external'}`;
      beNames.push(beName);
      let backendBlocks: string[] = [];
      for (const r of svcRegions) {
        usedRegions.add(r);
        const negName = `neg-${sid}-${r}`;
        if (!negNames.has(negName)) {
          negNames.add(negName);
          resources.push(`resource "google_compute_region_network_endpoint_group" "${negName}" {\n  name                 = "${negName}"\n  network_endpoint_type = "SERVERLESS"\n  region               = "${r}"\n  cloud_run {\n    service = "${sid}"\n  }\n}`);
        }
        backendBlocks.push(`  backend {\n    group = google_compute_region_network_endpoint_group.${negName}.id\n  }`);
      }
      if (isInternal) {
        resources.push(`resource "google_compute_region_backend_service" "${beName}" {\n  name                  = "${beName}"\n  region                = "${region}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "INTERNAL_MANAGED"\n  log_config { enable = true }\n${backendBlocks.join('\n')}\n}`);
        // Internal DNS record for service
        dnsRecords.push(`resource "google_dns_record_set" "${lbKey}_${sid.replace(/-/g, '_')}_dns" {\n  name         = "${sid}.${defaultDomain}."\n  type         = "A"\n  ttl          = 300\n  managed_zone = "bitbrat-local"\n  rrdatas      = [${ipRefExpr}]\n}`);
      } else {
        resources.push(`resource "google_compute_backend_service" "${beName}" {\n  name                  = "${beName}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  log_config { enable = true }\n${backendBlocks.join('\n')}\n}`);
      }
    }

    // Assets Proxy (External only)
    if (!isInternal && hasBucketRouting) {
      const regions = [...(usedRegions.size > 0 ? usedRegions : new Set([region]))];
      let backendBlocks: string[] = [];
      for (const r of regions) {
        const negName = `neg-assets-proxy-${r}`;
        if (!negNames.has(negName)) {
          negNames.add(negName);
          resources.push(`resource "google_compute_region_network_endpoint_group" "${negName}" {\n  name                 = "${negName}"\n  network_endpoint_type = "SERVERLESS"\n  region               = "${r}"\n  cloud_run {\n    service = "assets-proxy"\n  }\n}`);
        }
        backendBlocks.push(`  backend {\n    group = google_compute_region_network_endpoint_group.${negName}.id\n  }`);
      }
      const beName = `be-assets-proxy-${lbKey}`;
      beNames.push(beName);
      resources.push(`resource "google_compute_backend_service" "${beName}" {\n  name                  = "${beName}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  log_config { enable = true }\n${backendBlocks.join('\n')}\n}`);
    }

    // Default backend selection
    if (servicesToProcess.length === 0 && !hasBucketRouting) {
      const beName = `be-default-${lbKey}`;
      beNames.push(beName);
      if (isInternal) {
        resources.push(`resource "google_compute_region_backend_service" "${beName}" {\n  name                  = "${beName}"\n  region                = "${region}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "INTERNAL_MANAGED"\n  log_config { enable = true }\n}`);
      } else {
        resources.push(`resource "google_compute_backend_service" "${beName}" {\n  name                  = "${beName}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  log_config { enable = true }\n}`);
      }
    }

    const defaultBackendRef = servicesToProcess.length > 0
      ? `google_compute_${isInternal ? 'region_' : ''}backend_service.be-${servicesToProcess[0]}-${isInternal ? 'internal' : 'external'}.self_link`
      : `google_compute_${isInternal ? 'region_' : ''}backend_service.be-default-${lbKey}.self_link`;

    const urlMapName = lbNode.name || (isInternal ? `bitbrat-internal-url-map-${lbKey}` : 'bitbrat-global-url-map');

    if (isInternal) {
      resources.push(`resource "google_compute_region_url_map" "${lbKey}" {\n  name            = "${urlMapName}"\n  region          = "${region}"\n  default_service = ${defaultBackendRef}\n  lifecycle {\n    ignore_changes = [\n      default_service,\n      host_rule,\n      path_matcher,\n      test,\n    ]\n  }\n}`);
      resources.push(`resource "google_compute_region_target_http_proxy" "${lbKey}_proxy" {\n  name    = "${lbKey}-proxy-${environment}"\n  region  = "${region}"\n  url_map = google_compute_region_url_map.${lbKey}.self_link\n}`);
      resources.push(`resource "google_compute_forwarding_rule" "${lbKey}_fr" {\n  name                  = "${lbKey}-fr-${environment}"\n  region                = "${region}"\n  ip_protocol           = "TCP"\n  load_balancing_scheme = "INTERNAL_MANAGED"\n  port_range            = "80"\n  target                = google_compute_region_target_http_proxy.${lbKey}_proxy.self_link\n  network               = "brat-vpc"\n  subnetwork            = "brat-subnet-${region}-${environment}"\n  ip_address            = ${ipRefExpr}\n}`);
    } else {
      resources.push(`resource "google_compute_url_map" "${lbKey}" {\n  name            = "${urlMapName}"\n  default_service = ${defaultBackendRef}\n  lifecycle {\n    ignore_changes = [\n      default_service,\n      host_rule,\n      path_matcher,\n      test,\n    ]\n  }\n}`);
      resources.push(`resource "google_compute_target_https_proxy" "${lbKey}_proxy" {\n  name             = "${lbKey}-https-proxy-${environment}"\n  url_map          = google_compute_url_map.${lbKey}.self_link\n  ssl_certificates = [${certRefExpr}]\n}`);
      resources.push(`resource "google_compute_global_forwarding_rule" "${lbKey}_fr" {\n  name                  = "${lbKey}-https-fr-${environment}"\n  ip_address            = ${ipRefExpr}\n  port_range            = "443"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  target                = google_compute_target_https_proxy.${lbKey}_proxy.self_link\n}`);
    }
  }

  const tf = `# Synthesized by brat CDKTF synth (module: load-balancer)
# This file was generated to provision the BitBrat Load Balancer infrastructure.
# module: load-balancer

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
  }
${backendBlock}}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type    = string
  default = "${project}"
}

variable "region" {
  type    = string
  default = "${defaultRegion}"
}

variable "environment" {
  type    = string
  default = "${environment}"
}

${datas.join('\n\n')}

${resources.join('\n\n')}

${dnsRecords.join('\n\n')}

# Outputs
output "lbIpAddresses" {
  description = "Map of load balancer key to IP address"
  value = {
${outputIpMappings.join(',\n')}
  }
}
`;
  return tf;
}

function synthConnectorsTf(rootDir: string, env: string | undefined, projectId: string | undefined): string {
  let region = 'us-central1';
  try {
    const arch = loadArchitecture(rootDir) as any;
    region = arch?.deploymentDefaults?.region || arch?.defaults?.services?.region || region;
  } catch {}
  const environment = env || 'dev';
  const project = projectId || 'placeholder-project';
  const vpcName = 'brat-vpc';
  const subnetName = `brat-subnet-${region}-${environment}`;
  const connectorName = `brat-conn-${region}-${environment}`;
  const connectorCidr = '10.8.0.0/28';

  const bucket = process.env.BITBRAT_TF_BACKEND_BUCKET;
  const ci = String(process.env.CI || '').toLowerCase();
  const includeBackend = !!bucket && ci !== 'true' && ci !== '1';

  const backendBlock = includeBackend
    ? `  backend "gcs" {
    bucket = "${bucket}"
    prefix = "connectors/${environment}"
  }\n`
    : '';

  const tf = `# Synthesized by brat CDKTF synth (module: connectors)
# This file provisions Serverless VPC Access connectors and binds them to existing subnets.
# module: connectors

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
  }
${backendBlock}}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type    = string
  default = "${project}"
}

variable "region" {
  type    = string
  default = "${region}"
}

variable "environment" {
  type    = string
  default = "${environment}"
}

# Look up existing VPC and Subnet from the network stack
data "google_compute_network" "vpc" {
  name = "${vpcName}"
}

# Serverless VPC Access Connector
resource "google_vpc_access_connector" "connector" {
  name           = "${connectorName}"
  region         = var.region
  network        = data.google_compute_network.vpc.name
  ip_cidr_range  = "${connectorCidr}"
  max_instances  = 3
  min_instances  = 2
}

# Outputs
output "connectorsByRegion" {
  description = "Map of region to connector name"
  value       = { (var.region) = google_vpc_access_connector.connector.name }
}
`;
  return tf;
}

/**
 * synthBucketsTf
 * Generates Terraform for Google Cloud Storage buckets defined under
 * architecture.yaml -> infrastructure.resources where:
 *   type: object-store
 *   implementation: cloud-storage
 * Behavior:
 * - Bucket name: <resourceKey>-<env>
 * - Location: resource.location || deploymentDefaults.region
 * - Access policy: private (default) or public
 *   - public: enable uniform bucket-level access and bind allUsers roles/storage.objectViewer
 * - Versioning: enabled when resource.versioning === true
 * - Lifecycle: supports simple rules via resource.lifecycle.rules[] items with fields:
 *   - action: "Delete" | "SetStorageClass"
 *   - age: number (days)
 *   - storageClass: string (when SetStorageClass)
 * - Labels: merges required labels { env, project, managed-by=brat } with resource.labels (without overwriting required keys)
 */
function synthBucketsTf(rootDir: string, env: string | undefined, projectId: string | undefined): string {
  const arch: any = (() => { try { return loadArchitecture(rootDir) as any; } catch { return {}; } })();
  const environment = env || 'dev';
  const project = projectId || 'placeholder-project';
  const defaultRegion = arch?.deploymentDefaults?.region || arch?.defaults?.services?.region || 'us-central1';

  const resources: Record<string, any> = arch?.infrastructure?.resources || {};
  const bucketEntries = Object.entries(resources)
    .filter(([_, r]: [string, any]) => r && r.type === 'object-store' && r.implementation === 'cloud-storage')
    .map(([key, r]) => ({ key, cfg: r as any }));

  // Backend: disabled by default for safety in CI, but allow via env var like other modules
  const bucketBackend = process.env.BITBRAT_TF_BACKEND_BUCKET;
  const ci = String(process.env.CI || '').toLowerCase();
  const includeBackend = !!bucketBackend && ci !== 'true' && ci !== '1';
  const backendBlock = includeBackend
    ? `  backend "gcs" {\n    bucket = "${bucketBackend}"\n    prefix = "buckets/${environment}"\n  }\n`
    : '';

  // Provider + variables
  let tfParts: string[] = [];
  tfParts.push(`# Synthesized by brat CDKTF synth (module: buckets)
# This file provisions Google Cloud Storage buckets declared in architecture.yaml.
# module: buckets

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
  }
${backendBlock}}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type    = string
  default = "${project}"
}

variable "region" {
  type    = string
  default = "${defaultRegion}"
}

variable "environment" {
  type    = string
  default = "${environment}"
}`);

  // Helper to render labels
  function renderLabels(extra: Record<string, string | number | boolean> | undefined) {
    const base: Record<string, string> = {
      env: String(environment),
      project: String(project),
      'managed-by': 'brat',
    };
    const out: Record<string, string> = { ...base };
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra)) {
        if (k in base) continue; // do not overwrite required keys
        out[k] = String(v);
      }
    }
    const lines = Object.entries(out)
      .map(([k, v]) => `    ${JSON.stringify(k)} = ${JSON.stringify(v)}`)
      .join('\n');
    return `  labels = {\n${lines}\n  }`;
  }

  // Helper to render lifecycle rules (limited scope per planning doc)
  function renderLifecycle(lc: any): string {
    const rules: any[] = lc?.rules || [];
    if (!Array.isArray(rules) || rules.length === 0) return '';
    const blocks = rules.map((r) => {
      const actionType = r?.action || 'Delete';
      const age = typeof r?.age === 'number' ? r.age : undefined;
      const storageClass = r?.storageClass;
      const actionBlock = actionType === 'SetStorageClass' && storageClass
        ? `  action {\n    type          = "SetStorageClass"\n    storage_class = "${storageClass}"\n  }`
        : `  action {\n    type = "Delete"\n  }`;
      const condLines: string[] = [];
      if (typeof age === 'number') condLines.push(`    age = ${age}`);
      const conditionBlock = condLines.length > 0
        ? `  condition {\n${condLines.join('\n')}\n  }`
        : '';
      return `lifecycle_rule {\n${actionBlock}\n${conditionBlock}\n}`;
    });
    return blocks.join('\n');
  }

  // Iterate buckets and create resources + optional IAM for public
  let publicIamBindings: string[] = [];
  const bucketNames: string[] = [];
  const bucketItemsTf: string[] = [];
  for (const { key, cfg } of bucketEntries) {
    const location = cfg?.location || defaultRegion;
    const access = cfg?.access_policy || 'private';
    const versioning = !!cfg?.versioning;
    const lifecycle = cfg?.lifecycle;
    const labelsExtra = cfg?.labels || {};
    const bucketName = `${key}-${environment}`;
    bucketNames.push(bucketName);

    const iamConfig = access === 'public'
      ? `\n  iam_configuration {\n    uniform_bucket_level_access = true\n  }`
      : '';

    const versioningBlock = versioning ? `\n  versioning {\n    enabled = true\n  }` : '';
    const lifecycleBlock = lifecycle ? `\n${renderLifecycle(lifecycle)}` : '';
    const labelsBlock = `\n${renderLabels(labelsExtra)}`;

    const resName = `bucket_${key}`;
    bucketItemsTf.push(
      `resource "google_storage_bucket" "${resName}" {\n  name     = "${bucketName}"\n  location = "${location}"${versioningBlock}${iamConfig}${lifecycleBlock}${labelsBlock}\n}`
    );

    if (access === 'public') {
      publicIamBindings.push(
        `resource "google_storage_bucket_iam_member" "public_${key}" {\n  bucket = google_storage_bucket.${resName}.name\n  role   = "roles/storage.objectViewer"\n  member = "allUsers"\n}`
      );
    }
  }

  tfParts.push('', bucketItemsTf.join('\n\n'));
  if (publicIamBindings.length > 0) tfParts.push('', publicIamBindings.join('\n\n'));

  // Outputs
  const namesList = bucketNames.map(n => JSON.stringify(n)).join(', ');
  const urlsMap = bucketEntries.map(({ key }) => `    ${JSON.stringify(key)} = {\n      gs  = "gs://${key}-${environment}"\n      url = "https://storage.googleapis.com/${key}-${environment}"\n    }`).join('\n');
  tfParts.push(`
# Outputs
output "bucketNames" {
  description = "List of synthesized bucket names"
  value       = [${namesList}]
}

output "bucketUrlsByKey" {
  description = "Map of bucket key to gs and https URLs"
  value       = {
${urlsMap}
  }
}`);

  return tfParts.join('\n');
}

export function synthModule(moduleName: CdktfModule, opts: SynthOptions): string {
  const rootDir = opts.rootDir;
  const outDir = opts.outDir || getModuleOutDir(rootDir, moduleName);
  ensureDir(outDir);

  if (moduleName === 'network') {
    const tf = synthNetworkTf(rootDir, opts.env, opts.projectId);
    writeFileIfChanged(path.join(outDir, 'main.tf'), tf);
    const readme = `# network (CDKTF synth)\n\nThis directory is generated by the brat CLI.\nIt contains a Terraform configuration for the BitBrat network MVP (VPC, subnet with Private Google Access, Cloud Router, NAT, and baseline firewalls).\n\nState backend (GCS) is intentionally not configured here to keep CI plan-only runs safe.\nFor remote state, create a bucket (e.g., gs://bitbrat-tfstate-<env>) and configure a backend block manually when applying outside CI.\n`;
    writeFileIfChanged(path.join(outDir, 'README.md'), readme);
    return outDir;
  }

  if (moduleName === 'buckets') {
    const tf = synthBucketsTf(rootDir, opts.env, opts.projectId);
    writeFileIfChanged(path.join(outDir, 'main.tf'), tf);
    const readme = `# buckets (CDKTF synth)

This directory is generated by the brat CLI.
It contains a Terraform configuration for provisioning Google Cloud Storage buckets declared under infrastructure.resources.

Security defaults:
- Buckets are private by default.
- Public buckets require access_policy: public and will enable uniform bucket-level access and add an allUsers viewer binding.

Outputs:
- bucketNames: list of bucket resource names
- bucketUrlsByKey: map of key => { gs, url }
`;
    writeFileIfChanged(path.join(outDir, 'README.md'), readme);
    return outDir;
  }

  if (moduleName === 'connectors') {
      const tf = synthConnectorsTf(rootDir, opts.env, opts.projectId);
      writeFileIfChanged(path.join(outDir, 'main.tf'), tf);
      const readme = `# connectors (CDKTF synth)\n\nThis directory is generated by the brat CLI.\nIt contains a Terraform configuration for Serverless VPC Access connectors bound to existing network subnets.\n\nNotes:\n- Minimum CIDR size per connector is /28 (default used here: 10.8.0.0/28).\n- Ensure vpcaccess.googleapis.com API is enabled before apply.\n`;
      writeFileIfChanged(path.join(outDir, 'README.md'), readme);
      return outDir;
    }

    if (moduleName === 'load-balancer') {
    const tf = synthLoadBalancerTf(rootDir, opts.env, opts.projectId);
    writeFileIfChanged(path.join(outDir, 'main.tf'), tf);
    const readme = `# load-balancer (CDKTF synth)\n\nThis directory is generated by the brat CLI.\nIt contains a Terraform configuration for the BitBrat HTTPS Load Balancer scaffolding.\n\nNotes:\n- Dev static IP name: birtrat-ip\n- Dev certificate name: bitbrat-dev-cert\n- URL map is a minimal stub; advanced import is deferred.\n`;
    writeFileIfChanged(path.join(outDir, 'README.md'), readme);
    return outDir;
  }

  // Default minimal scaffold for other modules
  // Minimal Terraform project that can init/validate/plan without providers/resources
  const mainTf = `# Synthesized by brat CDKTF scaffold for module: ${moduleName}\n# This is a minimal placeholder to enable terraform init/validate/plan.\nterraform {\n  required_version = ">= 1.5.0"\n}\n`;
  writeFileIfChanged(path.join(outDir, 'main.tf'), mainTf);

  const readme = `# ${moduleName} (CDKTF scaffold)\n\nThis directory is generated by the brat CLI as a placeholder Terraform project.\nIt enables terraform plan/apply wiring while Phase 3 CDKTF implementation is being rolled out.\n`;
  writeFileIfChanged(path.join(outDir, 'README.md'), readme);

  return outDir;
}
