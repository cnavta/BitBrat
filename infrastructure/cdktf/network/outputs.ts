/**
 * Outputs type declarations for BitBrat Network stack
 */
export interface NetworkOutputs {
  vpcSelfLink: string;
  subnetSelfLinkByRegion: Record<string, string>;
  routersByRegion: Record<string, string>;
}
