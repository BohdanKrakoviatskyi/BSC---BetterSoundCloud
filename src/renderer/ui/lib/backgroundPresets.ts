export type UserBackgroundPreset = {
  id: string;
  name: string;
  image: string;
  createdAt: number;
};

const DATABASE_NAME = 'better-soundcloud-background-presets';
const STORE_NAME = 'presets';
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
  if (!image.startsWith('data:image/jpeg;base64,') || image.length > 700_000) {
    throw new Error('Изображение пресета имеет неподдерживаемый формат или слишком большой размер.');
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
