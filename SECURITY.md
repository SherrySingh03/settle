# Security

## Reporting a problem

Please report security issues privately through GitHub's **Report a vulnerability** button (Security tab of this
repository), not in a public issue.

## Things to know when you run Settle

- **Your keys are in your package.** `npm run build` packs `src/js/config.local.js` (TMDB, Trakt, OMDb, Unsplash
  keys) into `dist/Settle-<version>-local.wgt`. Keep the `.wgt` to yourself and never commit `config.local.js`.
- **Vetro runs as root and speaks plain HTTP.** Settle's Control Center sends shell commands to Vetro on the TV.
  Keep the TV on a trusted home network, never forward Vetro's port to the internet, and consider Vetro's own
  pairing setting. Read [Vetro's README](https://github.com/andrearicci93/vetro) before installing it.
- **The Diagnostics receiver** (`npm run logs`) accepts reports from anything on your network and writes them to
  `captures/`. Run it only while you need it.
- **Trakt tokens** are stored in the TV app's local storage. Disconnect in Trakt (Settings > Connected Apps) if the
  TV changes hands.
