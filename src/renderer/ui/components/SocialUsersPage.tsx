import type { SocialUser } from '../../domain/models';
import { ErrorMessage } from './ErrorMessage';
import { FaArrowLeft, FaArrowUpRightFromSquare } from '../lib/icons';
import { formatCount, initials } from '../lib/format';

type Props = {
  kind: 'followers' | 'followings';
  users: SocialUser[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  onBack: () => void;
  onSwitch: (kind: 'followers' | 'followings') => void;
  onLoadMore: () => void;
  onOpenProfile: (userId: number) => void;
};

export function SocialUsersPage({ kind, users, loading, error, hasMore, onBack, onSwitch, onLoadMore, onOpenProfile }: Props) {
  const title = kind === 'followers' ? 'Подписчики' : 'Подписки';
  return <article className="page-content social-users-page">
    <button className="track-detail-back" type="button" onClick={onBack}><FaArrowLeft aria-hidden="true" /> Назад</button>
    <header className="social-users-header">
      <div><h1>{title}</h1></div>
      <nav className="social-users-tabs" aria-label="Списки профиля">
        <button type="button" className={kind === 'followers' ? 'is-active' : ''} onClick={() => onSwitch('followers')}>Подписчики</button>
        <button type="button" className={kind === 'followings' ? 'is-active' : ''} onClick={() => onSwitch('followings')}>Подписки</button>
      </nav>
    </header>
    {error && <ErrorMessage message={error} />}
    {loading && users.length === 0
      ? <p className="social-users-state">Загружаю список…</p>
      : users.length === 0
        ? <p className="social-users-state">Список пока пуст.</p>
        : <div className="social-users-grid">{users.map((user) => {
            const name = user.fullName || user.username;
            return <button className="social-users-card" key={user.id} type="button" onClick={() => onOpenProfile(user.id)}>
              {user.avatar ? <img src={user.avatar} alt="" loading="lazy" /> : <span className="social-users-avatar-fallback">{initials(name)}</span>}
              <span className="social-users-copy"><b>{name}</b><small>@{user.username}</small><small>{formatCount(user.followersCount)} подписчиков · {formatCount(user.followingsCount)} подписок</small><small>{formatCount(user.trackCount)} треков</small></span>
              <span className="social-users-open" aria-hidden="true"><FaArrowUpRightFromSquare /></span>
            </button>;
          })}</div>}
    {hasMore && <button className="outline-button social-users-more" type="button" disabled={loading} onClick={onLoadMore}>{loading ? 'Загружаю…' : 'Показать ещё'}</button>}
  </article>;
}
