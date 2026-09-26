import { useState, useEffect } from 'react';

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
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
