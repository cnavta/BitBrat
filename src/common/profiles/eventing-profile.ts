import type { Bit } from '../base-server';
import { BitProfile } from './types';

/**
 * EventingProfile (Bit model, sprint-324, Phase 2).
 *
 * Bundles the event-plane helpers every event-driven Bit shares — message subscription (`onMessage`)
 * and routing-slip advancement (`next`/`complete`) already live on {@link Bit}; this profile exposes a
 * thin, convenience `publishEvent` over the platform publisher resource and asserts the event plane is
 * available. It is a marker/decorator: it adds no inheritance depth and changes no existing behavior.
 */
export const EventingProfile: BitProfile = {
  name: 'eventing',
  install(bit: Bit): void {
    const anyBit = bit as any;

    // Convenience publish helper over the platform publisher resource (idempotent: only define once).
    if (typeof anyBit.publishEvent !== 'function') {
      anyBit.publishEvent = async (subject: string, data: unknown, attributes?: Record<string, string>) => {
        const publisher = anyBit.getResource?.('publisher');
        if (!publisher) {
          bit.getLogger().warn('bit.eventing.publisher_missing', { subject });
          return false;
        }
        await publisher.create(subject).publishJson(data, attributes || {});
        return true;
      };
    }

    bit.getLogger().debug('bit.eventing.installed');
  },
};
