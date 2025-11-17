import fs from 'fs';
import path from 'path';
import { loadArchitecture } from '../config/loader';

export type CdktfModule = 'network' | 'load-balancer' | 'connectors';

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
  private_ip_google_access = true${flowLogsBlock}}

# Cloud Routers (per region)
resource "google_compute_router" "router" {
  for_each = toset(local.regions)
  name     = "brat-router-${'${'}each.key}"
  region   = each.key
  network  = google_compute_network.vpc.id
}

# Cloud NAT (per region)
resource "google_compute_router_nat" "nat" {
  for_each                           = google_compute_router.router
  name                               = "brat-nat-${'${'}each.key}"
  router                             = each.value.name
  region                             = each.key
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

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

output "natsByRegion" {
  description = "Map of region to NAT name"
  value       = { for r, s in google_compute_router_nat.nat : r => s.name }
}
`;
  return tf;
}

function synthLoadBalancerTf(rootDir: string, env: string | undefined, projectId: string | undefined): string {
  // Read inputs from new lb schema with backward-compat fallback to legacy infra node
  let defaultRegion = 'us-central1';
  let lb: any = undefined;
  let legacyLbNode: any = {};
  let defaultDomain = 'api.bitbrat.ai';
  try {
    const arch = loadArchitecture(rootDir) as any;
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

  const urlMapName = 'bitbrat-global-url-map';

  // Services and regions
  const services: Array<{ name: string; regions?: string[]; runService?: { name: string; projectId?: string } }>
    = Array.isArray(lb?.services) ? lb.services : [];

  // Backend state in CI guarded like other modules
  const bucket = process.env.BITBRAT_TF_BACKEND_BUCKET;
  const ci = String(process.env.CI || '').toLowerCase();
  const includeBackend = !!bucket && ci !== 'true' && ci !== '1';
  const backendBlock = includeBackend
    ? `  backend "gcs" {\n    bucket = "${bucket}"\n    prefix = "lb/${environment}"\n  }\n`
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

  // Per-service NEGs and Backend Services
  for (const svc of services) {
    const svcName = svc.name;
    const runSvc = svc.runService;
    const svcRegions = (svc.regions && svc.regions.length > 0) ? svc.regions : [defaultRegion];
    const beName = `be-${svcName}`;
    beNames.push(beName);
    // Build NEGs and collect attachments
    let backendBlocks: string[] = [];
    for (const r of svcRegions) {
      const negName = `neg-${svcName}-${r}`;
      negNames.push(negName);
      const projectAttr = runSvc?.projectId ? `\n  project = "${runSvc.projectId}"` : '';
      resources.push(`resource "google_compute_region_network_endpoint_group" "${negName}" {\n  name                 = "${negName}"\n  network_endpoint_type = "SERVERLESS"\n  region               = "${r}"\n  cloud_run {\n    service = "${runSvc?.name || svcName}"${projectAttr}\n  }\n}`);
      backendBlocks.push(`  backend {\n    group = google_compute_region_network_endpoint_group.${negName}.id\n  }`);
    }
    resources.push(`resource "google_compute_backend_service" "${beName}" {\n  name                  = "${beName}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  log_config { enable = true }\n${backendBlocks.join('\n')}\n}`);
  }

  // If no services declared, keep a default backend to keep URL map valid
  if (services.length === 0) {
    const beName = 'be-default';
    beNames.push(beName);
    resources.push(`resource "google_compute_backend_service" "${beName}" {\n  name                  = "${beName}"\n  protocol              = "HTTP"\n  load_balancing_scheme = "EXTERNAL_MANAGED"\n  log_config { enable = true }\n}`);
  }

  // URL Map and Proxy/FR referencing selected cert/ip
  const certRefExpr = useManagedCertResource
    ? 'google_compute_managed_ssl_certificate.managed_cert.self_link'
    : 'data.google_compute_ssl_certificate.managed_cert.self_link';
  const ipRefExpr = useIpResource
    ? 'google_compute_global_address.frontend_ip.address'
    : 'data.google_compute_global_address.frontend_ip.address';

  const defaultBackendRef = `google_compute_backend_service.${beNames[0]}.self_link`;

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
output "globalIpAddress" {
  description = "Frontend global IP address"
  value       = ${ipRefExpr}
}

output "urlMapName" {
  value = google_compute_url_map.main.name
}

output "certificateResourceNames" {
  value = [${useManagedCertResource ? 'google_compute_managed_ssl_certificate.managed_cert.name' : 'data.google_compute_ssl_certificate.managed_cert.name'}]
}

output "backendServiceNames" {
  value = [${beNames.map(n => `google_compute_backend_service.${n}.name`).join(', ')}]
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
  max_instances  = 2
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
