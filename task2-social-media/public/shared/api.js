/* =====================================================================
   Shared fetch wrapper used by all four apps.

   Everything goes through api() so that:
     - the auth cookie is always sent (credentials: 'include'),
     - a non-2xx reply becomes a thrown Error carrying the server's own
       message, which the UI can show directly,
     - a dropped connection produces a readable message instead of the
       browser's raw "Failed to fetch".
   ===================================================================== */

/**
 * Calls the API and returns the parsed JSON body.
 * Throws an Error whose .message is safe to show to the user and whose
 * .status is the HTTP code (401 lets callers redirect to the login screen).
 */
async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const options = {
    method,
    credentials: 'include', // send the httpOnly JWT cookie
    headers: {},
  };

  if (body !== undefined) {
    if (isForm) {
      // FormData sets its own multipart boundary; do not set Content-Type.
      options.body = body;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error('Cannot reach the server. Is it still running?');
  }

  // 204 and empty bodies have nothing to parse.
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: 'The server sent an unreadable response.' };
    }
  }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const API = {
  get: (p) => api(p),
  post: (p, body) => api(p, { method: 'POST', body }),
  put: (p, body) => api(p, { method: 'PUT', body }),
  patch: (p, body) => api(p, { method: 'PATCH', body }),
  del: (p) => api(p, { method: 'DELETE' }),
  upload: (p, formData, method = 'POST') => api(p, { method, body: formData, isForm: true }),
};

window.api = api;
window.API = API;
