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

# Proxy-only subnet for Regional Managed Load Balancers (Internal LB)
resource "google_compute_subnetwork" "proxy_only_subnet" {
  for_each      = toset(local.regions)
  name          = "brat-proxy-only-subnet-${'${'}each.key}"
  ip_cidr_range = "10.129.0.0/23" # Sprint 168: Fixed CIDR for proxy-only
  purpose       = "REGIONAL_MANAGED_PROXY"
  role          = "ACTIVE"
  region        = "${'${'}each.key}"
  network       = google_compute_network.vpc.id
}

# Cloud Routers (per region)
resource "google_compute_router" "router" {
  for_each = toset(local.regions)
  name     = "brat-router-${'${'}each.key}"
  region   = each.key
  network  = google_compute_network.vpc.id
}

# DNS Zones for Service Discovery
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
  /**
   * LB Synthesis — Routing-Driven Backends and Assets Proxy
   * Implements Sprint 22 objective:
   * - Derive referenced services from infrastructure.resources.<lb>.routing.rules[].service
   * - Filter to services that are active: true per architecture.yaml
   * - Synthesize per-region Serverless NEGs and be-<service> backends
   * - Conditionally synthesize be-assets-proxy and NEGs when any bucket routing exists
   * - Default backend is first service backend when present; else be-default
   * Backward-compat: if routing is absent, fall back to lb.services[] (deprecated)
   * Docs: planning/sprint-22-b91e6c/sprint-execution-plan.md, backlog.md (S22-001..S22-012)
   *
   * Dry-run instructions (S22-012):
   * - Local synth:
   *   - Run: `node -e "require('./tools/brat/dist/providers/cdktf-synth').synthModule('load-balancer',{rootDir: process.cwd(), env: 'dev', projectId: 'demo'})"`
   *   - Or via tests: `npm test -- tools/brat/src/providers/cdktf-synth.loadbalancer.routing.test.ts`
   * - Inspect outputs:
   *   - Generated files under infrastructure/cdktf/out/load-balancer/main.tf
   * - Optional terraform plan (no apply):
   *   - cd infrastructure/cdktf/out/load-balancer && terraform init -upgrade && terraform validate && terraform plan
   *   - CI/backends are guarded; state backend is disabled by default to keep plan-only safe.
   */
  let defaultRegion = 'us-central1';
  let lb: any = undefined;
  let legacyLbNode: any = {};
  let defaultDomain = 'api.bitbrat.ai';
  let arch: any = {};
  try {
    arch = loadArchitecture(rootDir) as any;
    defaultRegion = arch?.deploymentDefaults?.region || arch?.defaults?.services?.region || defaultRegion;
    lb = arch?.lb;
    legacyLbNode = arch?.infrastructure?.resources?.['main-load-balancer'] || arch?.infrastructure?.['main-load-balancer'] || {};
    defaultDomain = legacyLbNode?.routing?.default_domain || defaultDomain;
  } catch {}

  const environment = env || 'dev';
  const project = projectId || 'placeholder-project';

  // Resolve ip/cert modes with environment behavior
  const ipMode: 'create' | 'use-existing' = lb?.ipMode || 'use-existing';
  const ipName = lb?.ipName || legacyLbNode?.ip || (environment === 'dev' ? 'birtrat-ip' : 'bitbrat-global-ip');

  const certMode: 'managed' | 'use-existing' = lb?.certMode || 'use-existing';
  const certRefRaw: string | undefined = lb?.certRef || legacyLbNode?.cert || (environment === 'dev' ? 'bitbrat-dev-cert' : `bitbrat-cert-${environment}`);
  const certName = certRefRaw ? String(certRefRaw).split('/').slice(-1)[0] : `bitbrat-cert-${environment}`;

  const urlMapName = legacyLbNode?.name || 'bitbrat-global-url-map';

  // ROUTING-DRIVEN DERIVATION - Internal LB
  const internalLbNode = arch?.infrastructure?.resources?.['internal-load-balancer'];
  const internalRouting = internalLbNode?.routing;
  const internalLbIpName = internalLbNode?.ip || 'bitbrat-internal-ip';
  const internalLbName = internalLbNode?.name || 'bitbrat-internal-lb';

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
  let negNames: string[] = [];
  let beNames: string[] = [];

  // IP selection
  const isProd = environment === 'prod';
  const useIpResource = (!isProd && ipMode === 'create');
  if (useIpResource) {
    resources.push(`resource "google_compute_global_address" "frontend_ip" {\n  name = "${ipName}"\n}`);
  } else {
    // Fallback to data source in prod or when use-existing selected
    datas.push(`data "google_compute_global_address" "frontend_ip" {\n  name = "${ipName}"\n}`);
  }

  // Certificate selection
  const allowManagedInProd = isProd ? (certMode === 'managed') : (certMode === 'managed');
  const useManagedCertResource = (!isProd && certMode === 'managed') || (isProd && allowManagedInProd);
  if (useManagedCertResource) {
    // Use defaultDomain as placeholder domain for the managed cert
    resources.push(`resource "google_compute_managed_ssl_certificate" "managed_cert" {\n  name = "${certName}"\n  managed {\n    domains = ["${defaultDomain}"]\n  }\n}`);
  } else {
    datas.push(`data "google_compute_ssl_certificate" "managed_cert" {\n  name = "${certName}"\n}`);
  }

  // ROUTING-DRIVEN DERIVATION
  const routing = legacyLbNode?.routing;
  const servicesActiveMap: Record<string, boolean> = arch?.services || {};
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
    // Filter to active services only
    return ordered.filter((sid) => {
      const node = servicesActiveMap?.[sid];
      // servicesActiveMap may hold objects; treat { active: true } only as active
      const active = !!(node && typeof node === 'object' && (node as any).active === true);
      return active;
    });
  };

  const referencedServices = deriveUniqueServices();
  const hasBucketRouting = !!(routing?.default_bucket) || !!(Array.isArray(routing?.rules) && routing.rules.some((r: any) => !!r?.bucket));

  const deriveInternalServices = (): string[] => {
    if (!internalRouting || !Array.isArray(internalRouting?.rules)) return [];
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of internalRouting.rules as Array<any>) {
      const svc = r?.service;
      if (!svc || typeof svc !== 'string') continue;
      if (!seen.has(svc)) {
        seen.add(svc);
        ordered.push(svc);
      }
    }
    return ordered.filter(sid => !!(servicesActiveMap?.[sid] && (servicesActiveMap[sid] as any).active !== false));
  };

  const internalServices = deriveInternalServices();

  // Fallback to deprecated lb.services[] only when routing not provided
  type LegacySvc = { name: string; regions?: string[]; runService?: { name: string; projectId?: string } };
  const legacyServices: LegacySvc[] = (!routing && Array.isArray(lb?.services)) ? lb.services as LegacySvc[] : [];

  // Accumulate per-service regions used to inform assets-proxy NEGs
  const usedRegions = new Set<string>();
  const definedNegs = new Set<string>();

  const ensureNeg = (sid: string, region: string) => {
    const negName = `neg-${sid}-${region}`;
    const negId = negName;
    if (definedNegs.has(negId)) return negId;
    resources.push(`resource "google_compute_region_network_endpoint_group" "${negId}" {\n  name                 = "${negName}"\n  network_endpoint_type = "SERVERLESS"\n  region               = "${region}"\n  cloud_run {\n    service = "${sid}"\n  }\n}`);
    definedNegs.add(negId);
    negNames.push(negId);
    return negId;
  };

  // Build service backends/NEGs — routing path
  if (routing) {
    for (const sid of referencedServices) {
      const svcRegions = [defaultRegion];
      const beName = `be-${sid}`;
      const beId = beName;
      beNames.push(beId);
      let backendBlocks: string[] = [];
      for (const r of svcRegions) {
        usedRegions.add(r);
        const negId = ensureNeg(sid, r);
        backendBlocks.push(`  backend {\n    group = google_compute_region_network_endpoint_group.${negId}.id\n  }`);
      }
      resources.push(`resource "google_compute_backend_service" "${beId}" {\n  name                  = "${beName}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  log_config { enable = true }\n${backendBlocks.join('\n')}\n}`);
    }
  }

  // Internal Load Balancer Backends
  if (internalRouting) {
    resources.push(`resource "google_compute_address" "internal_load_balancer_ip" {\n  name         = "${internalLbIpName}"\n  subnetwork   = "brat-subnet-${defaultRegion}-${environment}"\n  address_type = "INTERNAL"\n  region       = "${defaultRegion}"\n}`);

    for (const sid of internalServices) {
      const svcRegions = [defaultRegion];
      const beName = `be-${sid}-internal`;
      const beId = beName;
      beNames.push(beId);
      let backendBlocks: string[] = [];
      for (const r of svcRegions) {
        usedRegions.add(r);
        const negId = ensureNeg(sid, r);
        backendBlocks.push(`  backend {\n    group = google_compute_region_network_endpoint_group.${negId}.id\n  }`);
      }
      resources.push(`resource "google_compute_region_backend_service" "${beId}" {\n  name                  = "${beName}"\n  region                = "${defaultRegion}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "INTERNAL_MANAGED"\n  log_config { enable = true }\n${backendBlocks.join('\n')}\n}`);
    }

    // Internal URL Map
    const internalHostRules = internalServices.map(sid => `  host_rule {\n    hosts        = ["${sid}.${internalRouting.default_domain}"]\n    path_matcher = "${sid}"\n  }`).join('\n');
    const internalPathMatchers = internalServices.map(sid => `  path_matcher {\n    name            = "${sid}"\n    default_service = google_compute_region_backend_service.be-${sid}-internal.self_link\n  }`).join('\n');

    resources.push(`resource "google_compute_region_url_map" "internal_load_balancer" {\n  name            = "${internalLbName}"\n  region          = "${defaultRegion}"\n  default_service = google_compute_region_backend_service.be-${internalServices[0]}-internal.self_link\n${internalHostRules}\n\n${internalPathMatchers}\n  lifecycle {\n    ignore_changes = [\n      default_service,\n      test,\n    ]\n  }\n}`);

    resources.push(`resource "google_compute_region_target_http_proxy" "internal_load_balancer_proxy" {\n  name    = "internal-load-balancer-proxy-${environment}"\n  region  = "${defaultRegion}"\n  url_map = google_compute_region_url_map.internal_load_balancer.self_link\n}`);

    resources.push(`resource "google_compute_forwarding_rule" "internal_load_balancer_fr" {\n  name                  = "internal-load-balancer-fr-${environment}"\n  region                = "${defaultRegion}"\n  ip_protocol           = "TCP"\n  load_balancing_scheme = "INTERNAL_MANAGED"\n  port_range            = "80"\n  target                = google_compute_region_target_http_proxy.internal_load_balancer_proxy.self_link\n  network               = "brat-vpc"\n  subnetwork            = "brat-subnet-${defaultRegion}-${environment}"\n  ip_address            = google_compute_address.internal_load_balancer_ip.address\n}`);

    // Internal DNS records
    for (const sid of internalServices) {
      resources.push(`resource "google_dns_record_set" "internal_load_balancer_${sid}-dns" {\n  name         = "${sid}.${internalRouting.default_domain}."\n  type         = "A"\n  ttl          = 300\n  managed_zone = "bitbrat-local"\n  rrdatas      = [google_compute_address.internal_load_balancer_ip.address]\n}`);
    }
  }

  // Build service backends/NEGs — legacy lb.services[] path (deprecated)
  if (!routing && legacyServices.length > 0) {
    for (const svc of legacyServices) {
      const svcName = svc.name;
      const runSvc = svc.runService;
      const svcRegions = (svc.regions && svc.regions.length > 0) ? svc.regions : [defaultRegion];
      const beName = `be-${svcName}`;
      const beId = beName;
      beNames.push(beId);
      let backendBlocks: string[] = [];
      for (const r of svcRegions) {
        usedRegions.add(r);
        const negId = ensureNeg(runSvc?.name || svcName, r);
        backendBlocks.push(`  backend {\n    group = google_compute_region_network_endpoint_group.${negId}.id\n  }`);
      }
      resources.push(`resource "google_compute_backend_service" "${beId}" {\n  name                  = "${beName}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  log_config { enable = true }\n${backendBlocks.join('\n')}\n}`);
    }
  }

  // Assets Proxy — only when bucket routing exists
  if (routing && hasBucketRouting) {
    const regions = [...(usedRegions.size > 0 ? usedRegions : new Set([defaultRegion]))];
    let backendBlocks: string[] = [];
    for (const r of regions) {
      const negId = ensureNeg('assets-proxy', r);
      backendBlocks.push(`  backend {\n    group = google_compute_region_network_endpoint_group.${negId}.id\n  }`);
    }
    const beName = 'be-assets-proxy';
    const beId = beName;
    beNames.push(beId);
    resources.push(`resource "google_compute_backend_service" "${beId}" {\n  name                  = "${beName}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  log_config { enable = true }\n${backendBlocks.join('\n')}\n}`);
  }

  // If no service backends declared, keep a default backend to keep URL map valid
  const hasServiceBackends = routing ? (referencedServices.length > 0) : (legacyServices.length > 0);
  if (!hasServiceBackends) {
    const beName = 'be-default';
    const beId = beName;
    beNames.push(beId);
    resources.push(`resource "google_compute_backend_service" "${beId}" {\n  name                  = "${beName}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  log_config { enable = true }\n}`);
  }

  // URL Map and Proxy/FR referencing selected cert/ip
  const certRefExpr = useManagedCertResource
    ? 'google_compute_managed_ssl_certificate.managed_cert.self_link'
    : 'data.google_compute_ssl_certificate.managed_cert.self_link';
  const ipRefExpr = useIpResource
    ? 'google_compute_global_address.frontend_ip.address'
    : 'data.google_compute_global_address.frontend_ip.address';

  // Default backend selection per Sprint 22 rules
  const defaultBackendRef = hasServiceBackends
    ? `google_compute_backend_service.be-${routing ? referencedServices[0] : (legacyServices[0]?.name)}.self_link`
    : 'google_compute_backend_service.be-default.self_link';

  const tf = `# Synthesized by brat CDKTF synth (module: load-balancer)
# This file was generated to provision the BitBrat HTTPS Load Balancer scaffolding.
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

${[...datas, ...resources].join('\n\n')}

# URL Map (stub)
resource "google_compute_url_map" "main" {
  name = "${urlMapName}"
  default_service = ${defaultBackendRef}
  lifecycle {
    ignore_changes = [
      default_service,
      host_rule,
      path_matcher,
      test,
    ]
  }
}

# Target HTTPS Proxy
resource "google_compute_target_https_proxy" "https_proxy" {
  name             = "bitbrat-https-proxy-${environment}"
  url_map          = google_compute_url_map.main.self_link
  ssl_certificates = [${certRefExpr}]
}

# Global Forwarding Rule for 443
resource "google_compute_global_forwarding_rule" "https_rule" {
  name                  = "bitbrat-https-fr-${environment}"
  ip_address            = ${ipRefExpr}
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.https_proxy.self_link
}

# Outputs
output "lbIpAddresses" {
  description = "Map of load balancer key to IP address"
  value = {
    "main-load-balancer" = ${ipRefExpr},
    "internal-load-balancer" = ${internalRouting ? 'google_compute_address.internal_load_balancer_ip.address' : 'null'}
  }
}

output "urlMapName" {
  value = google_compute_url_map.main.name
}

output "certificateResourceNames" {
  value = [${useManagedCertResource ? 'google_compute_managed_ssl_certificate.managed_cert.name' : 'data.google_compute_ssl_certificate.managed_cert.name'}]
}

output "backendServiceNames" {
  value = [${beNames.map(n => n.endsWith('-internal') ? `google_compute_region_backend_service.${n}.name` : `google_compute_backend_service.${n}.name`).join(', ')}]
}

output "negNames" {
  value = [${negNames.map(n => `google_compute_region_network_endpoint_group.${n}.name`).join(', ')}]
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
