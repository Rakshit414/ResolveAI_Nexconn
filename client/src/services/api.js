const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL)
  ? import.meta.env.VITE_API_URL
  : (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)
    ? 'http://localhost:5000'
    : '';

let inMemoryAgentToken = null;
let inMemoryCsrfToken = null;

export function setAgentAuthToken(token, csrfToken = null) {
  inMemoryAgentToken = token;
  if (csrfToken) inMemoryCsrfToken = csrfToken;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    if (token) window.sessionStorage.setItem('resolve_agent_token', token);
    else window.sessionStorage.removeItem('resolve_agent_token');
    if (csrfToken) window.sessionStorage.setItem('resolve_agent_csrf', csrfToken);
    else window.sessionStorage.removeItem('resolve_agent_csrf');
  }
}

export function getAgentAuthToken() {
  if (inMemoryAgentToken) return inMemoryAgentToken;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage.getItem('resolve_agent_token');
  }
  return null;
}

export function getAgentCsrfToken() {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage.getItem('resolve_agent_csrf');
  }
  return null;
}

/**
 * Helper for making typed API requests
 */
async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = getAgentAuthToken();
  const csrf = getAgentCsrfToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    ...options.headers,
  };

  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers,
      ...options,
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const err = new Error(errorData.error || errorData.message || `HTTP error ${res.status}`);
      err.status = res.status;
      err.errorData = errorData;
      throw err;
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

export const requestHumanAssistance = (id, customerName, reason) =>
  fetchAPI(`/api/tickets/${id}/human-handoff`, {
    method: 'POST',
    body: JSON.stringify({ customerName, reason }),
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

export const submitResolutionFeedback = (id, feedback) =>
  fetchAPI(`/api/tickets/${id}/feedback`, {
    method: 'POST',
    body: JSON.stringify(feedback),
  });

// Agent Sessions & Availability API
export const createAgentSession = (userId = 'user_sarah_lin', brandId = 'brand_novacart') =>
  fetchAPI('/api/agent/session', {
    method: 'POST',
    body: JSON.stringify({ userId, brandId }),
  }).then(res => {
    if (res?.sessionToken) {
      setAgentAuthToken(res.sessionToken, res.csrfToken);
    }
    return res;
  });

export const refreshAgentHeartbeat = () =>
  fetchAPI('/api/agent/heartbeat', {
    method: 'POST',
  });

export const getAgentProfile = (userId) => {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  return fetchAPI(`/api/agent/profile${query}`);
};

export const updateAgentStatus = (status, reason = '', userId = null) =>
  fetchAPI('/api/agent/status', {
    method: 'PATCH',
    body: JSON.stringify({ status, reason, userId }),
  });

export const terminateAgentSession = () =>
  fetchAPI('/api/agent/session/terminate', {
    method: 'POST',
  }).then(res => {
    setAgentAuthToken(null, null);
    return res;
  });

// Shared Inbox & Team Overview API
export const getUnassignedTickets = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetchAPI(`/api/inbox/unassigned${query ? `?${query}` : ''}`);
};

export const getMyTickets = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetchAPI(`/api/inbox/my-tickets${query ? `?${query}` : ''}`);
};

export const getTeamOverview = () =>
  fetchAPI('/api/inbox/team-overview');

export const getAgentRoster = () =>
  fetchAPI('/api/inbox/roster');

export const getTicketDetailsWithHistory = (ticketId) =>
  fetchAPI(`/api/inbox/tickets/${encodeURIComponent(ticketId)}`);

export const claimOrReassignTicket = (ticketId, targetAgentId = null) =>
  fetchAPI(`/api/inbox/tickets/${encodeURIComponent(ticketId)}/assign`, {
    method: 'POST',
    body: JSON.stringify({ targetAgentId }),
  });

export const transferTicket = (ticketId, { toAgentId, handoffSummaryJson, internalNotes = '', fromAgentId = null }) =>
  fetchAPI(`/api/inbox/tickets/${encodeURIComponent(ticketId)}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ toAgentId, handoffSummaryJson, internalNotes, fromAgentId }),
  });

export const resolveTicketWithCapacity = (ticketId) =>
  fetchAPI(`/api/inbox/tickets/${encodeURIComponent(ticketId)}/resolve`, {
    method: 'POST',
  });

export const sendAgentReply = (ticketId, messageText, dedupeKey = null) =>
  fetchAPI(`/api/inbox/tickets/${encodeURIComponent(ticketId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ messageText, dedupeKey }),
  });

// Knowledge Hub API
export const getKnowledgeItems = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetchAPI(`/api/knowledge/items${query ? `?${query}` : ''}`);
};

export const createKnowledgeItem = (data) =>
  fetchAPI('/api/knowledge/items', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateKnowledgeItem = (id, data) =>
  fetchAPI(`/api/knowledge/items/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const publishKnowledgeItem = (id) =>
  fetchAPI('/api/knowledge/publish', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

export const archiveKnowledgeItem = (id) =>
  fetchAPI('/api/knowledge/archive', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

export const getGroundedCopilotResponse = ({ query, conversationContext = '' }) =>
  fetchAPI('/api/knowledge/grounded-response', {
    method: 'POST',
    body: JSON.stringify({ query, conversationContext }),
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

export const translateText = (data) =>
  fetchAPI('/api/ai/translate', {
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

// Knowledge Base API (legacy compatibility)
export const getBusinessKnowledge = () => fetchAPI('/api/knowledge');

// Health Check
export const checkHealth = () => fetchAPI('/api/health');
