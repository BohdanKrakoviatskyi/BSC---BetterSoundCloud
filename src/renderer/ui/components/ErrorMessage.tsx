import { useState, useEffect } from 'react';
import { FaXmark } from '../lib/icons';

type Props = {
  message: string;
  onRetry?: () => void;
  className?: string;
};

/**
 * Самозакрывающееся сообщение об ошибке.
 * Кнопка × скрывает блок локально; сбрасывается, если текст ошибки изменился.
 */
export function ErrorMessage({ message, onRetry, className = '' }: Props) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [message]);
  if (dismissed) return null;
  return (
    <div className={`error-message${className ? ' ' + className : ''}`} role="alert">
      <span className="error-message-text">{message}</span>
      {onRetry && (
        <button type="button" className="home-retry" onClick={onRetry}>
          Повторить
        </button>
      )}
      <button
        type="button"
        className="error-message-close"
        aria-label="Закрыть"
        onClick={() => setDismissed(true)}
      >
        <FaXmark aria-hidden="true" />
      </button>
    </div>
  );
}
