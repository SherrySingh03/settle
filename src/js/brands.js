/*
 * Bundled logos for popular apps. Used when the TV's own icon is missing or unusable, and always for apps
 * marked useBrand in config.js (Netflix, YouTube). Each is a flat tile + a logo from img/brands/<key>.svg,
 * styled after the Google TV home screen: Netflix red N on black, Prime Video white wordmark with
 * the blue smile on dark navy, YouTube red play button on near-black, Xbox on green.
 * `p` is the logo's inset in % of the tile: [vertical, horizontal]. `always`: shown instead of the TV's own icon
 * wherever the app appears, without a config entry (for apps whose own icon looks poor on the dock).
 * Trademarks belong to their owners; used only to identify the apps.
 */
window.BRANDS = {
    netflix:    { bg: '#000000', p: [14, 31] },
    primevideo: { bg: '#0d1a2b', p: [33, 5] },
    youtube:    { bg: '#181818', p: [31, 14] },
    xbox:       { bg: '#107c10', p: [23, 23] },
    spotify:    { bg: '#16181C', p: [22, 22] },
    plex:       { bg: '#16181C', p: [18, 18] },
    appletv:    { bg: '#16181C', p: [32, 22] },
    disneyplus: { bg: '#0e2a8a', p: [30, 14] },
    stremio:    { bg: '#16181C', p: [21, 31], always: true },
    applemusic: { bg: '#16181C', p: [21, 31], always: true },
    samsunginternet: { bg: '#16181C', p: [21, 31], always: true }
};
