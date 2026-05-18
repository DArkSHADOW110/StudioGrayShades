(function () {
    const SESSION_KEY = 'supabase_session';
    const LOGGED_IN_KEY = 'isLoggedIn';

    function getConfig() {
        return window.APP_CONFIG || {};
    }

    function getSupabaseClient() {
        if (!window._supabaseClient) {
            const { SUPABASE_URL, SUPABASE_ANON_KEY } = getConfig();
            if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
                throw new Error('Supabase client not configured. Check config.js and the Supabase CDN script.');
            }
            window._supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
        return window._supabaseClient;
    }

    function getStoredSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function getAccessToken() {
        const session = getStoredSession();
        return session && session.access_token ? session.access_token : null;
    }

    function saveSession(session) {
        if (!session || !session.access_token) {
            throw new Error('Invalid session payload');
        }
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        localStorage.setItem(LOGGED_IN_KEY, 'true');
    }

    function clearAuthStorage() {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(LOGGED_IN_KEY);
        localStorage.removeItem('auth_token');
    }

    function isAuthenticated() {
        const session = getStoredSession();
        if (!session || !session.access_token) return false;
        const expiresAt = session.expires_at;
        if (expiresAt && Date.now() / 1000 >= expiresAt) return false;
        return true;
    }

    function getAuthHeaders() {
        const token = getAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function refreshSessionIfNeeded() {
        const session = getStoredSession();
        if (!session || !session.refresh_token) return session;

        const expiresAt = session.expires_at;
        const expiresSoon = expiresAt && expiresAt - Date.now() / 1000 < 120;
        if (!expiresSoon) return session;

        const client = getSupabaseClient();
        const { data, error } = await client.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token
        });

        if (error || !data.session) {
            clearAuthStorage();
            return null;
        }

        saveSession(data.session);
        return data.session;
    }

    async function signOut() {
        const token = getAccessToken();
        clearAuthStorage();
        if (token) {
            try {
                const client = getSupabaseClient();
                await client.auth.signOut();
            } catch (err) {
                console.warn('Supabase signOut:', err);
            }
        }
    }

    window.Auth = {
        getConfig,
        getSupabaseClient,
        getStoredSession,
        getAccessToken,
        saveSession,
        clearAuthStorage,
        isAuthenticated,
        getAuthHeaders,
        refreshSessionIfNeeded,
        signOut
    };
})();
