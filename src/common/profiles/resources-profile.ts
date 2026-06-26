import type { Bit } from '../base-server';
import { BitProfile } from './types';

/**
 * ResourcesProfile (Bit model, sprint-324, Phase 2).
 *
 * Bundles the managed-resource accessors (firestore / storage / publisher) that {@link Bit} already
 * realizes via its resource managers, exposing them as named convenience accessors. Marker/decorator:
 * no new inheritance depth and no behavioral change — it just makes the shared resource plane explicit.
 */
export const ResourcesProfile: BitProfile = {
  name: 'resources',
  install(bit: Bit): void {
    const anyBit = bit as any;

    if (typeof anyBit.getFirestore !== 'function') {
      anyBit.getFirestore = () => anyBit.getResource?.('firestore');
    }
    if (typeof anyBit.getStorage !== 'function') {
      anyBit.getStorage = () => anyBit.getResource?.('storage');
    }
    if (typeof anyBit.getPublisher !== 'function') {
      anyBit.getPublisher = () => anyBit.getResource?.('publisher');
    }

    bit.getLogger().debug('bit.resources.installed');
  },
};
