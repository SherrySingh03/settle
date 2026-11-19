/* Copy to config.local.js (gitignored), or run  npm run setup  to write it for you.
   Secrets and per-TV values only: everything else is in config.js, and anything set here overrides it
   (one level deep: e.g. controlCenter.vetroHost here keeps the rest of config.js's controlCenter).
   Every key is optional; a missing one only leaves that feature out. */
window.LAUNCHER_LOCAL = {
  keys: {
    tmdb: '',               // recommendations, posters, where to watch  https://www.themoviedb.org/settings/api
    traktClientId: '',      // personal picks, watchlist, Watched, Not interested  https://trakt.tv/oauth/applications
    traktClientSecret: '',  // optional: device login works without it
    omdb: '',               // IMDb ratings  https://www.omdbapi.com/apikey.aspx
    unsplash: '',           // daily wallpaper  https://unsplash.com/developers
    youtube: ''             // optional: "Trending on YouTube" above the dock (YouTube Data API v3 key)  https://console.cloud.google.com/apis/library/youtube.googleapis.com
  },
  region: 'IN',             // where-to-watch country (ISO 3166-1)
  locale: 'en-GB',
  controlCenter: {
    vetroHost: '',          // the TV's own LAN address, if Vetro refuses loopback to apps
    logUrl: ''              // Diagnostics > OK sends a report here, e.g. 'http://<your-pc-ip>:8787/' (npm run logs)
  },
  weather: { latitude: null, longitude: null, label: '' }   // null = located once from your IP address
};
