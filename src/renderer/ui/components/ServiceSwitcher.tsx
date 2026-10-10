import { SERVICE_PROVIDERS, type ServiceProvider } from '../../domain/models';
import type { ServiceAccount } from '../../domain/models';
import { CloudGlyph, SpotifyGlyph, YouTubeGlyph } from './AuthIcons';
import './ServiceSwitcher.css';

type Props = {
  activeService: ServiceProvider;
  /** One entry per service. Missing entries are treated as not connected. */
  accounts: Partial<Record<ServiceProvider, ServiceAccount>>;
  /** True while a switch is in flight, so the row can refuse to be clicked twice. */
  switching: boolean;
  onSwitch: (service: ServiceProvider) => void;
  /** Shown per service when it is connected. */
  busyService?: ServiceProvider | null;
};

const SERVICE_LABELS: Record<ServiceProvider, string> = {
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  'youtube-music': 'YouTube Music',
};

function ServiceGlyph({ service }: { service: ServiceProvider }) {
  if (service === 'spotify') return <SpotifyGlyph className="service-switcher__glyph" />;
  if (service === 'youtube-music') return <YouTubeGlyph className="service-switcher__glyph" />;
  return <CloudGlyph className="service-switcher__glyph" />;
}

/**
 * Single segmented control for switching services. Logo-only: each segment shows just the
 * service mark, the active one reads as the selected segment, and a dot marks a usable
 * session. A service with no account still gets a segment — it is how the user gets to the
 * sign-in for it.
 *
 * Accessible names carry the full text, because a logo alone tells a screen reader nothing.
 */
export function ServiceSwitcher({ activeService, accounts, switching, onSwitch, busyService }: Props) {
  return (
    <div className="service-switcher" role="group" aria-label="Сервис">
      {SERVICE_PROVIDERS.map((service) => {
        const account = accounts[service];
        const connected = Boolean(account?.isLoggedIn);
        const isActive = service === activeService;
        const isBusy = busyService === service;

        const name = connected
          ? `${SERVICE_LABELS[service]}, подключено как ${account?.profile?.username ?? 'пользователь'}`
          : `${SERVICE_LABELS[service]}, не подключено`;

        return (
          <button
            key={service}
            type="button"
            className={`service-switcher__item${isActive ? ' is-active' : ''}${connected ? ' is-connected' : ''}`}
            // Disabled while a switch is running: two switches in flight would race for the same state,
            // and the loser would quietly win the screen.
            disabled={switching}
            aria-current={isActive ? 'true' : undefined}
            aria-label={name}
            title={name}
            onClick={() => onSwitch(service)}
          >
            <ServiceGlyph service={service} />

            {/*
              The dot carries the connection state rather than only being decoration: green is a service
              with a usable session, dim is one that will ask for a sign-in when chosen.
            */}
            <span
              className={`service-switcher__dot${connected ? ' is-on' : ''}`}
              data-busy={isBusy ? 'true' : undefined}
              title={connected ? 'Подключено' : 'Не подключено'}
            />
          </button>
        );
      })}
    </div>
  );
}
