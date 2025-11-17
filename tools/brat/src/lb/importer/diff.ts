import { UrlMapYaml } from '../urlmap/schema';

function isObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sortArray(a: any[]): any[] {
  return a.map(normalize).sort((x: any, y: any) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
}

export function normalize(obj: any): any {
  if (Array.isArray(obj)) return sortArray(obj);
  if (!isObject(obj)) return obj;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    // drop ephemeral fields commonly present in gcloud describe
    if (k === 'fingerprint' || k === 'creationTimestamp' || k === 'id' || k === 'selfLink' || k === 'kind') continue;
    out[k] = normalize(v as any);
  }
  // Stable key order
  return Object.keys(out).sort().reduce((acc, k) => { acc[k] = out[k]; return acc; }, {} as Record<string, any>);
}

export function diffObjects(a: any, b: any): { changed: boolean; before?: any; after?: any } {
  const na = normalize(a);
  const nb = normalize(b);
  const changed = JSON.stringify(na) !== JSON.stringify(nb);
  return { changed, before: na, after: nb };
}

export function desiredYamlToObject(yamlObj: UrlMapYaml): any {
  // Already a JS object; just normalize pathMatchers order by name and routeRules by priority
  const obj = JSON.parse(JSON.stringify(yamlObj));
  if (Array.isArray(obj.pathMatchers)) {
    obj.pathMatchers.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    for (const pm of obj.pathMatchers) {
      if (Array.isArray(pm.routeRules)) {
        pm.routeRules.sort((a: any, b: any) => Number(a.priority) - Number(b.priority));
      }
    }
  }
  return obj;
}
