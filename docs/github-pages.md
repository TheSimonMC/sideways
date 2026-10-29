# Optional self-hosting

V11 is delivered as files in the chat. Open `SIDEWAYS-v11.html`, or extract the complete `SIDEWAYS-v11.zip` and open its root `SIDEWAYS.html`, to play single-player offline. No website is required for that.

If you want to host your copy, the single HTML can be renamed `index.html` and served as a static page. The separate module edition is in `dist/`. Keep the included credits and licenses when distributing either edition.

## Build a publishing folder

From the extracted source project, with Node.js 24:

```sh
npm ci
node build.mjs
node qa/standalone-check.mjs
node qa/package-v11.mjs
```

The packager writes `release/pages/`, ready for static hosting. It also writes the standalone HTML and complete project ZIP under `release/`. Generated archives and private repository metadata are excluded from ZIP inputs.

## GitHub Pages

To publish the prepared website manually:

1. Upload the contents of `release/pages/` into the root of a repository you control. `index.html` must be directly in the publishing folder.
2. Keep every asset directory and the empty `.nojekyll` file.
3. In Settings > Pages, choose the branch containing those files and `/ (root)`.
4. Wait for deployment and use the HTTPS URL shown by GitHub.

The complete V11 ZIP is a source project. Its `docs/` directory contains documentation, not a game entry point. Build `release/pages/` first, or publish the standalone HTML as `index.html`.

GitHub's [publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) explain the branch and folder settings.

## Included Actions workflow

The source includes `.github/workflows/pages.yml`. It builds the standalone, checks the embedded assets and SDK, runs multiplayer checks, and packages `release/pages/`. The deployment job uses GitHub's Pages environment.

Set Settings > Pages > Source to GitHub Actions before using it. The workflow runs on pushes to `main` or through Run workflow. Change its branch filter if needed. Local packaging does not push source, start Actions, create a repository or publish anything.

See GitHub's [custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) for Pages permissions and deployment settings.

## Multiplayer

Every participant should use V11. The host creates a lobby, guests enter its code and ready up, then the host starts. Single-player NPC races do not need the multiplayer service.

Multiplayer uses the included PeerJS client and WebRTC. PeerJS Cloud introduces the browsers; a configured TURN relay can help networks that cannot connect directly. Static hosting does not provide signaling or relay services. A network that blocks those services can still block multiplayer when the game itself runs from a local file. The lobby retains a failure reason and Copy Error Details button.

[Multiplayer details](multiplayer.md), the [PeerJS configuration API](https://peerjs.com/client/api/peer) and [MDN's connectivity guide](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity) explain the connection model. Optional signaling and temporary TURN credentials are entered in the lobby. Do not put private relay credentials into a published file.

## Common problems

- For a downloaded copy, open the root `SIDEWAYS.html`. Opening `dist/index.html` directly through `file:` can prevent its module imports; use the standalone or serve the module directory over HTTP.
- If a hosted page returns 404, check that `index.html` is at the root of the selected publishing folder.
- If there is no sound, click or press a key, check the game's volume and the browser's mute setting.
- Controller and wheel support depends on the inputs exposed by the browser and driver. Controls includes calibration and live readings. Some browsers expose devices only in secure contexts.
- If source packaging reports stale game files, run `node build.mjs` again.

No live GitHub deployment or cross-network WebRTC connection was performed for this release. `qa/` contains the automated validation reports and their scope.
