import { DEFAULT_SERVICE, type ServiceProvider } from '../domain/models';
import type { ServiceAdapter } from './serviceAdapter';
import { soundcloudAdapter } from './adapters/soundcloudAdapter';
import { spotifyAdapter } from './adapters/spotifyAdapter';
import { youtubeMusicAdapter } from './adapters/youtubeMusicAdapter';

/**
 * Registry of the available services and which one the interface is showing.
 *
 * Read-only for everything except register and switchTo. There is one instance for the app, and the
 * active service is a single fact that many components need to agree on — letting each of them keep
 * its own copy is how they drift apart.
 */
class ServiceManager {
  private readonly adapters = new Map<ServiceProvider, ServiceAdapter>();

  private activeService: ServiceProvider = DEFAULT_SERVICE;

  constructor(adapters: ServiceAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
    // SoundCloud is the app as it exists today, so it is always available even before anything
    // registers it. Without this the manager would start unusable.
    if (!this.adapters.has(DEFAULT_SERVICE)) this.register(soundcloudAdapter);
    // Registered, not yet reachable from the UI. App.tsx still talks to appGateway directly, so
    // nothing changes for the user until the call sites are migrated; having it in the registry means
    // the service picker can offer it as soon as there is a picker to offer it from.
    if (!this.adapters.has('spotify')) this.register(spotifyAdapter);
    if (!this.adapters.has('youtube-music')) this.register(youtubeMusicAdapter);
  }

  register(adapter: ServiceAdapter): void {
    this.adapters.set(adapter.service, adapter);
  }

  getAdapter(service: ServiceProvider): ServiceAdapter | undefined {
    return this.adapters.get(service);
  }

  get allServices(): ServiceProvider[] {
    return [...this.adapters.keys()];
  }

  get has(): boolean {
    return this.adapters.size > 0;
  }

  /**
   * The adapter every screen should be talking to.
   *
   * Throws rather than returning undefined: a screen that silently got nothing back would render an
   * empty library and look like a network failure. An unregistered service is a programming mistake
   * and should say so at the point of the mistake.
   */
  get active(): ServiceAdapter {
    const adapter = this.adapters.get(this.activeService);
    if (!adapter) throw new Error(`[services] адаптер для ${this.activeService} не зарегистрирован`);
    return adapter;
  }

  get current(): ServiceProvider {
    return this.activeService;
  }

  /**
   * Point the app at another service.
   *
   * Returns the adapter so a caller can use it without a second lookup, and it registers nothing on
   * its own — an adapter has to be registered before it can be switched to, so a missing integration
   * fails at registration rather than halfway through a switch.
   */
  switchTo(service: ServiceProvider): ServiceAdapter {
    const adapter = this.adapters.get(service);
    if (!adapter) throw new Error(`[services] нельзя переключиться на ${service}: адаптер не зарегистрирован`);
    this.activeService = service;
    return adapter;
  }

  /** Whether the service can be shown at all right now. */
  isRegistered(service: ServiceProvider): boolean {
    return this.adapters.has(service);
  }
}

export const serviceManager = new ServiceManager([soundcloudAdapter]);
