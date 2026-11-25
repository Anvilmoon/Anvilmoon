// Anvilmoon settings. The game talks to the server at the same address it was loaded from.
window.ANVILMOON_DEV = window.ANVILMOON_DEV || false;
window.ANVILMOON_SERVER = location.origin;
// Discord and Google sign-in run through Supabase Auth. A provider's buttons appear once it is listed here.
window.ANVILMOON_AUTH = { url: 'https://macpadytmqfjmczimoid.supabase.co', providers: [] };
