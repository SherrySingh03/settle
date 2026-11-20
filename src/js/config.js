/*
 * Settle configuration. Secrets and per-TV values go in config.local.js (gitignored),
 * which is merged over this one level deep.
 *
 * apps: each entry resolves to the first installed app matching it:
 *   { id: 'org.tizen.netflix-app' }   exact app id
 *   { match: 'hotstar' }              case-insensitive regex on id or name
 * `tone` is only the background of the text-chip fallback (no icon / offline).
 *   brand: 'youtube'                  bundled mark (js/brands.js) used when the app's own icon is missing
 *   logo: 'img/brands/x.png'          a bundled logo used INSTEAD of the app's own icon (for apps whose package
 *                                     ships only Samsung's generic pinwheel)
 *   useBrand: true                   show the bundled dark logo even when the TV has an icon of its own
 *   prefer: ['app.id']                the first of these installed wins over other matches (the rest are left out)
 *   chip: true                        always show the name, never the icon (for apps whose package ships
 *                                     only Samsung's generic pinwheel)
 */
window.LAUNCHER_CONFIG = {
    locale: 'en-GB',
    region: 'IN',
    idleMs: 60000,

    apps: [
        { id: 'org.tizen.netflix-app', label: 'Netflix', brand: 'netflix', useBrand: true, tone: '#2B3A4A' },
        // prefer: Samsung's own YouTube (signed in) over the old store app when a TV has both
        { match: 'youtube', prefer: ['com.samsung.tv.cobalt-yt'], label: 'YouTube', brand: 'youtube', useBrand: true, tone: '#3A2F2A' },
        { id: 'org.tizen.primevideo', label: 'Prime Video', brand: 'primevideo', useBrand: true, tone: '#26363A' },
        { match: 'hotstar', label: 'JioHotstar', tone: '#14194a', logo: 'img/brands/jiohotstar.png' },
        { match: 'spotify', label: 'Spotify', brand: 'spotify', tone: '#2C3A2E' },
        { match: 'plex', label: 'Plex', brand: 'plex', tone: '#3A3524' },
        { id: 'com.samsung.tv.aria-video', label: 'Apple TV', brand: 'appletv', useBrand: true, tone: '#2A2D33' }
    ],

    // Idle screensaver: launches the Aerial Screensaver app after this long with no remote input on the home screen.
    //   appId: '' finds the installed app whose id or name contains "aerial"; set it to use a specific app.
    //   timeoutMs: 0 turns it off. The Control Center's Screensaver tile overrides this on the TV.
    screensaver: { appId: 'AerialScr0.AerialScreensaver', timeoutMs: 120000 },
    // Open in Nuvio (turned on in Control Center > Settle): the first app in `apps` that is installed opens the title.
    // Both take an app control whose data <key> holds the link, with {type} (from types) and {tmdb} filled in; an app
    // can override operation, key or types. Values as each app documents them:
    //   Nuvio Legacy: iqui27/nuvio-native-legacy docs/deeplink.md (Tizen needs a version with PR #807 in it).
    //   the official Nuvio web app: NuvioMedia/NuvioWeb, js/core/deeplink.
    nuvio: { name: 'Nuvio', operation: 'http://tizen.org/appcontrol/operation/default', key: 'contentTarget',
             types: { movie: 'movie', tv: 'series' },
             apps: [{ appId: 'NuvioTV002.Nuvio', link: 'nuvio-legacy://meta/{type}/{tmdb}' },
                    { appId: 'NuvioTV001.NuvioTV', link: 'nuvio://tmdb/{type}/{tmdb}' }] },

    // The Samsung Home button: tried in this order until one actually takes the screen (all are on the 2025 QN70F's
    // app list; home.media and home.sidebar are the ones running as Smart Hub there). Add your TV's if it differs.
    samsungHome: ['com.samsung.tv.home.media', 'com.samsung.tv.home.sidebar', 'com.samsung.tv.coba.newhome', 'com.samsung.tv.csfs', 'com.samsung.tv.coba.edenview'],

    // Trailers play in the YouTube app through YouTube's cast protocol, which needs the app's screen id. The TV's DIAL
    // service may refuse to give it to anything on the TV itself (2025 QN70F: 401 from 127.0.0.1, Vetro included), so
    // read it once from a computer on the same network:
    //   curl -H "Origin: https://www.youtube.com" http://<tv-ip>:8080/ws/apps/YouTube
    // and copy <screenId> into config.local.js as  youtube: { screenId: '...' }. It stays the same across restarts.
    // Left empty, Settle tries to read it through Vetro.
    youtube: { screenId: '' },

    // Dynamic backdrop. images:false keeps only the colour fields (no backdrop pictures are fetched or decoded):
    // the lightest setting, if a screen with a lot going on feels slow.
    backdrop: { images: true },

    // TMDB watch-provider id per app label (https://api.themoviedb.org/3/watch/providers/movie?watch_region=IN).
    // The backdrop and "Popular on" title for a focused dock app come from /discover with this id. An app that is
    // not listed is matched to TMDB's provider list by name; one with no match just keeps its icon-colour backdrop.
    tmdbProviders: {
        'Netflix': 8, 'Prime Video': 119, 'JioHotstar': 2336, 'Apple TV': 350, 'Plex': 538, 'Zee5': 232, 'SonyLIV': 237,
        'MUBI': 11, 'Crunchyroll': 283, 'MX Player': 515, 'aha': 532, 'Sun NXT': 309, 'Hoichoi': 315, 'YouTube': 192
    },

    // Recommendation "where to watch" provider name -> app label above
    providerApps: {
        'Netflix': 'Netflix', 'Prime Video': 'Prime Video', 'Amazon Prime Video': 'Prime Video',
        'JioHotstar': 'JioHotstar', 'Disney Plus Hotstar': 'JioHotstar', 'Apple TV': 'Apple TV',
        'Apple TV Plus': 'Apple TV', 'YouTube': 'YouTube', 'Plex': 'Plex'
    },

    // The All apps screen lists applications only (store apps and a few preloaded ones; services and internals are left out).
    //   include: ['AbCdEfGhIj.Name']   force an app id to appear
    //   hide:    ['regex']              hide anything whose id or name matches
    // org.tizen.art-app is Samsung's Art mode (ArtApp), on TVs that have it; its system-style id would otherwise hide it.
    allApps: { include: ['org.tizen.art-app'], hide: [] },

    /*
     * Control Center (Red key). Talks to Vetro (port 8099) through js/vetro.js only. Every command comes from APL Launcher's
     * published source; where APL noted a value on another model (a Smart Monitor M8) the list is here so it can be corrected.
     *   vetroHost      the TV's LAN address, if the app cannot reach Vetro on loopback (some 2025 TVs).
     *   pictureModes   [code, name]: the codes the TV's AV service uses. Dynamic/Standard/Eco/Movie are APL's; add yours.
     *   inputs         { type, label }: APL maps HDMI 1-4 to types 13-16 (TV = 0).
     *   soundModes     [code, name] for Sound mode (APL: Standard 1, Amplify 5).
     *   audioDevices   { name, mac }: Bluetooth speakers/headphones to switch sound to. Listing paired devices needs a
     *                  privileged Tizen API, so they are named here: "TV speakers" is always offered.
     */
    controlCenter: {
        vetroPort: 8099,
        vetroHost: '',          // the TV's own LAN address, e.g. '<tv-ip>', if loopback is refused (set it in config.local.js)
        pictureModes: [[65536, 'Dynamic'], [65537, 'Standard'], [65552, 'Eco'], [65538, 'Movie']],
        inputs: [{ type: 13, label: 'HDMI 1' }, { type: 14, label: 'HDMI 2' }, { type: 15, label: 'HDMI 3' }, { type: 16, label: 'HDMI 4' }, { type: 0, label: 'TV' }],
        soundModes: [[1, 'Standard'], [5, 'Amplify']],
        audioDevices: [],
        logUrl: ''                    // where Diagnostics > OK sends its report, e.g. 'http://<your-pc-ip>:8787/' (scripts/logserver.mjs)
    },

    // HDMI ports shown on the Sources screen (names only; the TV reports the ports)
    inputs: [],

    weather: { latitude: null, longitude: null, label: '' },
    // width/height of the stored wallpaper. Measured on the TV: devicePixelRatio 1 and a 1920x1080 render surface,
    // so anything larger is decoded and then downscaled. 1920x1080 ~8 MB decoded, 2560x1440 ~14 MB, 3840x2160 ~33 MB.
    // query: Unsplash searches, used in turn (30 photos per search are fetched at once; the last 300 shown are skipped).
    wallpaper: {
        query: ['mountain landscape', 'ocean coast', 'forest', 'lake reflection', 'desert dunes', 'aurora night sky',
                'waterfall', 'misty valley', 'canyon', 'snowy peaks', 'countryside fields', 'tropical beach'],
        width: 1920, height: 1080
    },
    // omdb: a free key from https://www.omdbapi.com/apikey.aspx, for the IMDb rating in the movie panel (none: no rating)
    keys: { tmdb: '', traktClientId: '', traktClientSecret: '', unsplash: '', omdb: '' }
};

(function () {
    'use strict';
    var local = window.LAUNCHER_LOCAL;
    if (!local) return;
    function plain(v) { return v && typeof v === 'object' && !Array.isArray(v); }
    Object.keys(local).forEach(function (k) {
        if (plain(local[k]) && plain(window.LAUNCHER_CONFIG[k])) {
            Object.keys(local[k]).forEach(function (i) { window.LAUNCHER_CONFIG[k][i] = local[k][i]; });
        } else {
            window.LAUNCHER_CONFIG[k] = local[k];
        }
    });
})();
