const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:5000';

/**
 * Helper for making typed API requests
 */
async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `HTTP error ${res.status}`);
    }

    return await res.json();
  } catch (error) {
    console.warn(`API call failed for ${endpoint}:`, error.message);
    throw error;
  }
}

// Tickets API
export const getTickets = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetchAPI(`/api/tickets${query ? `?${query}` : ''}`);
};

export const getTicket = (id) => fetchAPI(`/api/tickets/${id}`);

export const updateTicket = (id, updates) =>
  fetchAPI(`/api/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

export const requestHumanAssistance = (id) =>
  fetchAPI(`/api/tickets/${id}/human-handoff`, {
    method: 'POST',
  });

export const takeOverTicket = (id) =>
  fetchAPI(`/api/tickets/${id}/take-over`, {
    method: 'POST',
  });

export const resolveTicket = (id) =>
  fetchAPI(`/api/tickets/${id}/resolve`, {
    method: 'POST',
  });

export const resetTickets = () =>
  fetchAPI('/api/tickets/reset', {
    method: 'POST',
  });

// AI Copilot API
export const analyzeConversation = (data) =>
  fetchAPI('/api/ai/analyze', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const summarizeConversation = (data) =>
  fetchAPI('/api/ai/summarize', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getSuggestedReply = (data) =>
  fetchAPI('/api/ai/suggest-reply', {
    method: 'POST',
    body: JSON.stringify(data),
  });

// Nexconn API
export const getNexconnToken = (userData) =>
  fetchAPI('/api/nexconn/token', {
    method: 'POST',
    body: JSON.stringify(userData),
  });

export const getNexconnStatus = () => fetchAPI('/api/nexconn/status');

// Knowledge Base API
export const getBusinessKnowledge = () => fetchAPI('/api/knowledge');

// Health Check
export const checkHealth = () => fetchAPI('/api/health');
