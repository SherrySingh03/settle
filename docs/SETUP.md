# Setting up Settle

This guide takes you from a fresh clone to Settle running on your TV, with the Home button opening it.

1. [What you need](#1-what-you-need)
2. [Get the code and configure it](#2-get-the-code-and-configure-it)
3. [Build the package](#3-build-the-package)
4. [Put the TV in Developer Mode](#4-put-the-tv-in-developer-mode)
5. [Install Settle with Apps2Samsung](#5-install-settle-with-apps2samsung)
6. [Optional: Vetro (Home button, Control Center)](#6-optional-vetro-home-button-control-center)
7. [Optional: a screensaver app](#7-optional-a-screensaver-app)
8. [Updating](#8-updating)
9. [Troubleshooting and Diagnostics](#9-troubleshooting-and-diagnostics)

---

## 1. What you need

- **A Samsung Tizen TV** (2016 or later). Settle is developed on a QN70F (2025, Tizen 9).
- **A computer** on the same network as the TV, with [Node.js](https://nodejs.org/) 20 or newer and git.
- **[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung)** to install the package (Windows, macOS, Linux
  or Android). It creates the Samsung signing certificate for you.
- **Optional, free API keys** (each one only turns on a feature; Settle runs without any of them):

| Key | Turns on | Where to get it |
| --- | --- | --- |
| TMDB API key (v3) | recommendations, posters, where to watch | <https://www.themoviedb.org/settings/api> |
| Trakt client id | personal picks, watchlist, Watched, Not interested | <https://trakt.tv/oauth/applications>: create an app, Redirect URI `urn:ietf:wg:oauth:2.0:oob` |
| OMDb API key | IMDb ratings | <https://www.omdbapi.com/apikey.aspx> (click the activation link in their email first) |
| Unsplash access key | a new wallpaper every day | <https://unsplash.com/developers> |

- **Optional: [Vetro](https://github.com/andrearicci93/vetro)** on the TV, for the Home button, the Control Center
  and the free-memory figure in the app switcher. Vetro needs root on the TV; see [section 6](#6-optional-vetro-home-button-control-center).

## 2. Get the code and configure it

```sh
git clone https://github.com/SherrySingh03/settle.git
cd settle
npm install
npm run setup
```

`npm run setup` asks for your keys, your country (for where-to-watch data), the TV's address (for Vetro) and
where to send Diagnostics reports, then writes **`src/js/config.local.js`**. Run it again any time to change
something: your previous answers are the defaults.

Prefer to do it by hand? Copy `src/js/config.local.example.js` to `src/js/config.local.js` and fill it in.

> `config.local.js` holds your keys. It is gitignored: never commit it, and never share a `.wgt` built with it.

Everything that is not a secret lives in `src/js/config.js`, with comments: the dock's default apps, which
streaming app each TMDB provider maps to, the screensaver timeout, the Control Center's picture and sound modes,
and so on. Anything you set in `config.local.js` overrides it.

**Try it in a browser first:**

```sh
npm run preview          # http://localhost:8080
```

Use the arrow keys, Enter for OK and Esc for Back; `d`, `c`, `g` and `e` stand in for the Yellow, Red, Green
and Blue buttons. The preview uses stand-in data for the TV (installed apps, Vetro) and your real keys for TMDB,
Trakt and the rest.

## 3. Build the package

```sh
npm run build            # -> dist/settle.wgt
```

The package is unsigned; Apps2Samsung signs it when it installs it. The build also minifies the JavaScript and
stamps the build time, which Diagnostics shows so you can tell which build is on the TV.

The app id is `SettleTv01.Settle` (set in `src/config.xml`). Keep it: the Home button mapping and the TV's
"installed" state are tied to it.

## 4. Put the TV in Developer Mode

Developer Mode lets a computer install apps on the TV.

1. On the TV, open **Apps** (the Apps panel in Smart Hub).
2. With the remote, type **1 2 3 4 5** (on remotes without number keys, use the on-screen number pad that some
   models show). A Developer Mode dialog appears. If it does not, try typing the numbers faster.
3. Turn **Developer mode** **On**, and set **Host PC IP** to your computer's local address (for example
   `192.168.1.50`; on Windows run `ipconfig`, on macOS or Linux `ip addr` or the network settings).
4. Restart the TV: hold the remote's power button until the TV turns off and on again (a full restart, not
   standby).

Apps2Samsung checks this for you and says "Developer Mode off" or "Host PC IP pointing elsewhere" when something
is not right. Its wiki has a [Developer Mode FAQ](https://github.com/Apps2Samsung/Apps2Samsung) with model-specific
tips.

> Turning Developer Mode off removes sideloaded apps.

## 5. Install Settle with Apps2Samsung

1. Install and open Apps2Samsung, and pick your TV.
2. Choose **your own `.wgt`** and select `dist/settle.wgt`, then **Install**.
3. The first time, Apps2Samsung asks you to sign in to Samsung once to create a signing certificate; it reuses it
   for every later install. (It picks a Public or Partner certificate depending on what the app needs.)
4. Settle appears in the TV's apps. Open it.

Settle asks the TV for these permissions (in `src/config.xml`): launch apps, read the installed-app list, watch
for apps being installed, close apps (the app switcher), register remote buttons, the TV window (HDMI sources),
and the internet.

## 6. Optional: Vetro (Home button, Control Center)

[Vetro](https://github.com/andrearicci93/vetro) is an open-source manager that runs on the TV with root access. It
offers a dashboard on your network, a debloater and a remote **Remapper**. Settle uses it for three things:

- **The Home button opens Settle**: a Remapper rule, set up once in Vetro's dashboard.
- **The Control Center** (Red, or Play/Pause twice): picture and sound mode, inputs, Bluetooth, Wi-Fi, sleep,
  brightness. Settle sends these as shell commands to Vetro's local HTTP service on port 8099; all of that code is in
  `src/js/vetro.js`.
- **Free memory** in the app switcher, and a fallback for closing apps.

Without Vetro, everything else works; those tiles say Vetro is not reachable.

> **Read Vetro's README before installing it.** Rooting changes how the TV works and Vetro calls itself
> experimental. Its service is plain HTTP with root access: keep the TV on a trusted home network and never expose
> it to the internet. Vetro supports Tizen 6 to 9; Tizen 10 cannot be rooted yet.

**Install Vetro.** The simplest route is Apps2Samsung: Vetro is in its catalog (marked with a `root` badge, and it
asks you to confirm). Vetro's README also describes a manual route with Tizen Studio. Then, as Vetro's README
says:

1. Open Vetro once on the TV.
2. In Developer Mode (Apps, then 1 2 3 4 5), set **Host PC IP** to **`127.0.0.1`** and restart the TV.

When you later install or update Settle with Apps2Samsung, it tells you if Host PC IP needs to point back at your
computer; switch it, install, then set it to `127.0.0.1` again for Vetro.

**Point Settle at Vetro.** Some TVs refuse apps a connection to their own loopback address, so give Settle the
TV's network address: `npm run setup` (the "TV LAN address" question), or `controlCenter.vetroHost` in
`config.local.js`. You find the address on the TV under **Settings > General > Network > Network Status**. Rebuild
and reinstall after changing it.

**Map the Home button to Settle.**

1. On your computer, open Vetro's dashboard: `http://<tv-address>:8099`.
2. Open the **Remapper**, add a rule for the **Home** button, and choose **Settle** (`SettleTv01.Settle`) as the
   app to open.
3. Press Home on the remote: Settle comes up. Its **Samsung Home** button (top right) still opens the stock home
   screen when you want it.

**Pairing.** Vetro can require each browser or app to pair with a code shown on the TV ("Require pairing" in
Vetro's developer settings). Settle has no pairing screen yet: if Diagnostics says *Vetro needs this app to be
paired*, turn that setting off (only on a network you trust).

**Opening the app switcher with Home.** Settle counts Home pressed twice quickly as "open the app switcher".
Settle never sees the Home key itself, only Vetro relaunching it, and on some TVs that relaunch does not reach a
Settle that is already on screen. If double Home does nothing on your TV, use the **Green** button.

## 7. Optional: a screensaver app

After 2 minutes with no remote input on the home screen, Settle opens a screensaver app if one is installed: it
looks for an app whose id or name contains "aerial", or the one set as `screensaver.appId` in `config.js`. Change
the timeout (or turn it off) on the Control Center's Screensaver tile.

## 8. Updating

```sh
git pull
npm install
npm run build
```

Then install `dist/settle.wgt` again with Apps2Samsung. Your dock layout and settings on the TV are kept.

## 9. Troubleshooting and Diagnostics

Press **Yellow** in Settle to open Diagnostics: the build, the app list, icons, keys pressed, the screensaver's
decisions, the Vetro connection and recent errors.

**Send a full report to your computer:**

1. Set the "Diagnostics log receiver" in `npm run setup` (it suggests `http://<your-computer>:8787/`), rebuild
   and reinstall.
2. Run `npm run logs` on the computer.
3. On the TV press **Yellow**, then **OK**. The report is saved in `captures/` (gitignored).

> Reports contain your network details and the TV's app list. Remove anything private before sharing one in an
> issue.

**Common problems**

| Problem | Try |
| --- | --- |
| The dock is empty for a while after the TV starts | The TV can take tens of seconds to answer the app list after a cold start; Settle retries and keeps the last known list. Prefer standby to switching the TV fully off. |
| No recommendations | Check the TMDB key (`npm run setup`), rebuild, reinstall. The Control Center's Recommendations tile refreshes on demand and says why if it cannot. |
| No IMDb rating | The OMDb key has to be activated from OMDb's email. |
| Control Center tiles say Vetro is unreachable | Vetro is not running, Host PC IP is not `127.0.0.1`, or Settle needs the TV's address (`vetroHost`). |
| "Vetro needs this app to be paired" | Turn off Require pairing in Vetro's developer settings (see section 6). |
| Install fails with a certificate or privilege error | Let Apps2Samsung recreate the certificate; make sure Developer Mode and Host PC IP are right and the TV was fully restarted. |
| Home does not open Settle | Check the Remapper rule in Vetro's dashboard points at `SettleTv01.Settle`. |
