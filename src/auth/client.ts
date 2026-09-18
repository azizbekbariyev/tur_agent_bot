const BASE = import.meta.env.VITE_BACKEND_URL;

async function handle<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.message ?? fallbackMessage;
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }
  return res.json();
}

function requestInit(json = false): RequestInit {
  return {
    credentials: 'include',
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
  };
}
