/* Preview-only stand-in data (design board content). Excluded from the .wgt build. */
(function () {
    'use strict';
    // Which Nuvio apps the preview has: both by default; window.__nuvio = 'legacy' or 'official' for one, __noNuvio for none.
    var NV = (window.LAUNCHER_CONFIG.nuvio || {}).apps || [], nvMode = window.__noNuvio ? '' : (window.__nuvio || 'both');
    var nvApps = (nvMode === 'both' || nvMode === 'legacy' ? ['Nuvio Legacy'] : []).concat(nvMode === 'both' || nvMode === 'official' ? ['Nuvio'] : []);
    window.MOCK = {
        // Exercises the icon pipeline in the browser: one good icon, one unreadable path (-> text chip).
        icons: { 'Netflix': 'img/preview-wide.svg', 'YouTube': '/nonexistent/res/ignition.png', 'Spotify': 'img/preview-icon.svg', 'Plex': '/nonexistent/res/ignition.png', 'Kodi': 'img/preview-generic.svg', 'Apple Music': 'img/preview-generic.svg' },
        // Extra installed apps so the dock editor has something to add in the browser preview.
        apps: ['Xbox', 'Disney+', 'Twitch', 'Apple Music', 'Stremio', 'Kodi', 'Crunchyroll', 'Weather', 'Calendar', 'Photos', 'Browser', 'Gallery', 'Fitness', 'Music', 'News', 'Games', 'Radio', 'Podcasts', 'Maps', 'Sling', 'Hulu', 'Tubi', 'Pluto TV', 'a1 Sorting Test'].concat(nvApps),
        // Preview apps whose real TV id matters (Nuvio is found by its id): config's first Nuvio app, then its second.
        ids: { 'Nuvio Legacy': (NV[0] || {}).appId, 'Nuvio': (NV[1] || {}).appId },
        // Things the TV lists as visible but that are not applications: they must never reach All apps.
        hidden: ['ep-dataservice-app', 'adplatform.ADPlayer', 'klciSQIYEM.ContinueWatchingService', 'org.tizen.settings-service', 'WykOS4t4F0.cmsWebApp'],
        // Apps "running" in the preview, for the app switcher (ids as the mock app list makes them).
        running: ['mock.YouTube', 'org.tizen.netflix-app', 'mock.Spotify', 'org.tizen.tv-viewer', 'klciSQIYEM.ContinueWatchingService', 'mock.Kodi'],
        weather: '21° Clear · Bengaluru',
        weatherShort: '21° Clear',
        recs: [
            ['Northbound', '#2E3B4E', '#C46A3C', 'circle', 'Prime Video', 'Prime Video', 'Streaming in India', '2024 · Thriller · 1h 52m · U/A 16+', 'A long-haul trucker takes one last northbound run and discovers what the cargo really is.'],
            ['Salt & Signal', '#3B3430', '#E3D3B8', 'bar', 'JioHotstar', 'JioHotstar', 'Streaming in India', '2025 · Drama · 2h 01m · U/A 13+', 'Two lighthouse keepers trade coded messages across a decade of storms.'],
            ['The Quiet Monsoon', '#1F3A3A', '#7DB9B0', 'arch', 'Netflix', 'Netflix', 'Streaming in India · also on Prime Video to rent', '2025 · Drama · 2h 06m · U/A 13+', 'A retired radio operator in Kochi hears a broadcast that shouldn’t exist, and follows it up the coast through one long monsoon.'],
            ['Eleven Rivers', '#3A2A3F', '#D98BA3', 'circle', 'SonyLIV', 'SonyLIV', 'Streaming in India', '2023 · Adventure · 2h 14m · U/A 13+', 'A surveyor maps eleven rivers in a single dry season.'],
            ['Paper Kites', '#40331C', '#F0C86A', 'arch', 'MUBI', 'MUBI', 'Streaming in India', '2022 · Family · 1h 38m · U', 'Three cousins, one rooftop, one festival day.', true],
            ['Low Orbit', '#1C2333', '#9FB4E0', 'circle', 'Apple TV · rent', 'Apple TV', 'Rent in India', '2024 · Sci-fi · 2h 20m · U/A 13+', 'A salvage crew finds a station that should have fallen years ago.'],
            ['The Long Table', '#3A2420', '#E39A6E', 'bar', 'Netflix', 'Netflix', 'Streaming in India', '2025 · Comedy · 1h 44m · U/A 13+', 'One wedding feast, forty relatives, no seating plan.'],
            ['Glasshouse', '#203226', '#A8D5A2', 'arch', 'Prime Video', 'Prime Video', 'Streaming in India', '2023 · Mystery · 1h 57m · U/A 16+', 'An orchid grower is the only witness to a very quiet crime.'],
            ['Ember Season', '#33221A', '#F08A4B', 'circle', 'Zee5', 'Zee5', 'Streaming in India', '2024 · Drama · 2h 09m · U/A 13+', 'A village waits out the burning season together.']
        ].map(function (r, i) {
            return { id: 'm' + i, tmdb: 900100 + i, title: r[0], bg: r[1], fg: r[2], shape: r[3], prov: r[4], provider: r[5], note: r[6],
                     meta: r[7], desc: r[8], wl: !!r[9], streaming: true };
        }),
        // The TV shows row without a TMDB key: made-up shows, like the films above.
        shows: [
            ['Harbour Lights', '#1E2F3A', '#6FB3C8', 'arch', 'Netflix', 'Netflix', 'Streaming in India', '2025 · Drama · 2 seasons · U/A 16+', 'A ferry captain keeps the last night crossing running, and everyone aboard has a reason to be there.'],
            ['The Night Desk', '#2A2633', '#B59BE0', 'bar', 'Prime Video', 'Prime Video', 'Streaming in India', '2024 · Crime · 1 season · U/A 16+', 'A newspaper night shift chases one story that the morning edition must not print.'],
            ['Monsoon Kitchen', '#3A2B1C', '#E8B25E', 'circle', 'JioHotstar', 'JioHotstar', 'Streaming in India', '2023 · Comedy · 3 seasons · U/A 13+', 'A family restaurant survives one rainy season at a time.'],
            ['Signal Lost', '#1A2430', '#7FA7D9', 'circle', 'Apple TV', 'Apple TV', 'Streaming in India', '2025 · Sci-fi · 1 season · U/A 13+', 'A remote research station loses contact with everything except one radio frequency.'],
            ['Small Hours', '#2C2A22', '#D7CBA0', 'arch', 'SonyLIV', 'SonyLIV', 'Streaming in India', '2024 · Drama · 2 seasons · U/A 13+', 'A hospital ward between midnight and dawn.'],
            ['Tidewater', '#1C302A', '#86C9A8', 'bar', 'Zee5', 'Zee5', 'Streaming in India', '2022 · Mystery · 2 seasons · U/A 16+', 'A coastal town where the tide keeps returning things that were lost.']
        ].map(function (r, i) {
            return { id: 's' + i, tmdb: 900200 + i, title: r[0], bg: r[1], fg: r[2], shape: r[3], prov: r[4], provider: r[5], note: r[6],
                     meta: r[7], desc: r[8], type: 'tv', streaming: true };
        })
    };
})();

/* Preview stand-in for the TV behind Vetro: it answers the same shell commands the adapter sends, so the
   preview exercises the real command building and parsing. Excluded from the .wgt build with the rest of mock.js. */
(function () {
    'use strict';
    var CC = (window.LAUNCHER_CONFIG.controlCenter = window.LAUNCHER_CONFIG.controlCenter || {});
    if (!CC.audioDevices || !CC.audioDevices.length) CC.audioDevices = [{ name: 'AirPods Pro', mac: 'AA:BB:CC:11:22:33' }, { name: 'Soundbar', mac: 'AA:BB:CC:44:55:66' }];
    var tv = { bt: null, sleepAt: 0, gov: 'interactive', v: { GetBacklight: 32, GetPictureMode: 65537, GetContrast: 45, GetSharpness: 10, GetColorStrength: 25, GetColorTint: 15,
                                          GetEyeSaverMode: 0, GetAdaptivePicture: 1, GetHdmiBlackLevel: 1, GetSoundMode: 1, GetAutoVolume: 1, GetAiAudioSceneBased: 0 } };
    var SET = { SetBacklight: 'GetBacklight', SetPictureMode: 'GetPictureMode', SetContrast: 'GetContrast', SetSharpness: 'GetSharpness', SetColorStrength: 'GetColorStrength',
                SetColorTint: 'GetColorTint', SetEyeSaverMode: 'GetEyeSaverMode', SetAdaptivePicture: 'GetAdaptivePicture', SetHdmiBlackLevel: 'GetHdmiBlackLevel',
                SetSoundMode: 'GetSoundMode', SetAutoVolume: 'GetAutoVolume', SetAiAudioSceneBased: 'GetAiAudioSceneBased' };
    window.MOCK.tv = tv;
    window.MOCK.cmdLog = [];
    window.MOCK.vetro = function (cmd) {
        window.MOCK.cmdLog.push(cmd);
        var out = '', m;
        if (cmd.indexOf('echo ') === 0 && cmd.indexOf('GetBacklight') > 0) {          // the read-everything command
            var re = /echo (\w+) \$\(busctl[^)]*?(Get\w+)[^)]*\)/g, x;
            while ((x = re.exec(cmd))) out += x[1] + ' ii ' + tv.v[x[2]] + ' 0\n';
            out += 'BT_BEGIN\n' + (tv.bt ? "(('" + tv.bt + "',),)" : '()') + '\nBT_END\nWIFI_BEGIN\n*AO MockNet wifi_abc_managed_psk\nWIFI_END\nGOV ' + tv.gov + '\n';
        } else if ((m = /^echo (performance|interactive) > \/sys\/devices\/system\/cpu\/cpufreq\/policy0\/scaling_governor/.exec(cmd))) { tv.gov = m[1]; out = tv.gov; }
        else if (/^cat \/sys\/devices\/system\/cpu\/cpufreq\/policy0\/scaling_governor/.test(cmd)) { out = tv.gov; }
        else if ((m = /(Set\w+) \w+ (?:-- )?(-?\d+)(?: 1)?(?= 2>&1|;|$)/.exec(cmd)) && SET[m[1]]) {
            tv.v[SET[m[1]]] = +m[2];
            out = 'i 0\nii ' + tv.v[SET[m[1]]] + ' 0';
        } else if ((m = /buds_switching_connect ([0-9A-F:]{17})/.exec(cmd))) { tv.bt = m[1]; }
        else if (/disconnect_last_btspk_list/.test(cmd)) { tv.bt = null; }
        else if ((m = /^echo (\d+) > \/tmp\/settle-sleep-at/.exec(cmd))) { tv.sleepAt = +m[1]; }
        else if (/^rm -f \/tmp\/settle-sleep-at/.test(cmd)) { tv.sleepAt = 0; }
        else if (/MemAvailable/.test(cmd)) { out = 'MemAvailable:     ' + (402000 + 61000 * (6 - window.MOCK.running.length)) + ' kB'; }
        return Promise.resolve({ ok: true, output: out });
    };
})();
