# Contributing

Thanks for helping. Settle runs on TVs with little memory and slow CPUs, so a few rules keep it fast.

## Working on it

```sh
npm install
npm run setup        # optional keys; without them the preview uses stand-in data
npm run preview      # http://localhost:8080 (arrows, Enter, Esc; d/c/g/e = Yellow/Red/Green/Blue)
npm run build        # dist/Settle-<version>-local.wgt
```

The preview loads `src/js/mock.js`, which fakes the TV: an app list, running apps and a stand-in Vetro that
answers the same shell commands as the real one. `mock.js` is never packaged.

## Budgets (please keep to them)

- No framework. Plain ES5-style JavaScript in IIFEs, one file per concern.
- Under 150 KB of JavaScript in the package (`npm run build` prints the size), under 600 DOM nodes.
- Animations: `transform` and `opacity` only, 200 ms or less; no blur or box-shadow on anything that animates.
- Timers: nothing fires more than once a second, and nothing polls. Use one-shot timers and events.
- Text is at least 24 px (it is read from a sofa).
- Memory: aim to keep the app under 60 MiB resident on the TV.

## Rules for TV and service calls

- Every Vetro call lives in `src/js/vetro.js`. Other modules use its adapter, never `fetch` to Vetro directly.
- Don't invent an endpoint or a command. If an API shape cannot be confirmed (published docs, a published client,
  or a capture from a real TV), leave the feature out and say so in the pull request.
- Shell text sent to Vetro is built only from validated values (numbers from fixed lists, strict patterns).
- Secrets go in `config.local.js` only; never put a key, address or personal detail in `config.js`, docs or tests.

## Pull requests

- Describe what you changed and how you tested it: preview only, or on which TV model and Tizen version.
- For a bug on a real TV, a Diagnostics report (Yellow, then OK, with `npm run logs` running) helps a lot. Remove
  anything private (addresses, account names) before attaching it.
- Keep changes focused; match the surrounding style and comments.

By contributing you agree that your contribution is licensed under the MIT licence of this project.
