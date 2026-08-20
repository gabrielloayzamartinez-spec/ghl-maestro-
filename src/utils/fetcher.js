export async function fetchWithRetry(url, options, attempt = 1) {
  try {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 2000 * attempt;
      console.log(`[Rate Limit] 429 Detectado. Esperando ${waitTime}ms (Intento ${attempt})...`);
      await new Promise(r => setTimeout(r, waitTime));
      if (attempt < 5) return fetchWithRetry(url, options, attempt + 1);
    }
    return res;
  } catch (err) {
    if (err.name === 'FetchError' || err.code === 'ECONNRESET') {
      console.log(`[Red] Error de conexión detectado. Reintentando en 2s (Intento ${attempt})...`);
      await new Promise(r => setTimeout(r, 2000));
      if (attempt < 5) return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  }
}
