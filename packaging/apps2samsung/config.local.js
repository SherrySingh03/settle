/* Settle settings for a catalogue install. Apps2Samsung asks for these values before installing and writes them in here
   (see SherrySingh03__settle.json next to this file: each "find" below must stay exactly as it is, or installs fail).
   The release build (npm run build:public) ships this file as js/config.local.js, unminified. Every key is optional
   except the country: a missing key only leaves its feature out. */
window.LAUNCHER_LOCAL = {
  region: "IN",
  keys: {
    tmdb: "",
    traktClientId: "",
    omdb: "",
    unsplash: "",
    youtube: "",
  },
  controlCenter: { vetroHost: "" },
  youtube: { screenId: "" }
};
