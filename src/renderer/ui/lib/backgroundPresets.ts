export type UserBackgroundPreset = {
  id: string;
  name: string;
  image: string;
  createdAt: number;
};

/** True for a preset whose image carries its own animation. */
export function isAnimatedPreset(image: string): boolean {
  return image.startsWith('data:image/gif;base64,');
}

const DATABASE_NAME = 'better-soundcloud-background-presets';
const STORE_NAME = 'presets';
/**
 * Formats a preset may hold. Kept in step with the validator in `main.go`, which refuses any
 * data URL outside this list.
 */
const PRESET_IMAGE_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
  'data:image/gif;base64,',
] as const;
/**
 * An animation is stored as the untouched file, because a canvas would flatten it to one
 * frame, so it needs a much larger ceiling than a redrawn still image.
 */
const MAX_PRESET_FILE_BYTES = 12 * 1024 * 1024;
/** Derived from the file limit for the same reason as in `SettingsPanel.tsx`. */
const MAX_PRESET_LENGTH = 'data:image/gif;base64,'.length + Math.ceil((MAX_PRESET_FILE_BYTES * 4) / 3) + 64;
let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Локальное хранилище пресетов недоступно.'));

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть хранилище пресетов.'));
    request.onblocked = () => reject(new Error('Хранилище пресетов занято другим окном приложения.'));
  });

  databasePromise = opening;
  void opening.catch(() => {
    if (databasePromise === opening) databasePromise = null;
  });
  return opening;
}

export async function loadUserBackgroundPresets(): Promise<UserBackgroundPreset[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<UserBackgroundPreset[]>;
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать сохранённые пресеты.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Не удалось прочитать сохранённые пресеты.'));
  });
}

export async function createUserBackgroundPreset(name: string, image: string): Promise<UserBackgroundPreset> {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 32) throw new Error('Название пресета должно содержать от 1 до 32 символов.');
  if (!PRESET_IMAGE_PREFIXES.some((prefix) => image.startsWith(prefix))) {
    throw new Error('Изображение пресета имеет неподдерживаемый формат. Сохрани можно JPEG, PNG, WebP или GIF.');
  }
  if (image.length > MAX_PRESET_LENGTH) {
    throw new Error('Изображение пресета слишком большое. Выбери файл поменьше.');
  }

  const preset: UserBackgroundPreset = {
    id: crypto.randomUUID(),
    name: normalizedName,
    image,
    createdAt: Date.now(),
  };
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).add(preset);
    transaction.oncomplete = () => resolve(preset);
    transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось сохранить пресет.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Не удалось сохранить пресет.'));
  });
}

export async function deleteUserBackgroundPreset(id: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось удалить пресет.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Не удалось удалить пресет.'));
  });
}
