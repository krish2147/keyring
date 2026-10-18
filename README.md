# Keyring

A private password vault you install on your phone. Every login is encrypted on the device with your master password (AES-256-GCM, key from PBKDF2 with 310,000 rounds). Nothing is sent to any server. It works offline.

## What's in this folder

| File | What it does |
| --- | --- |
| `index.html` | The app's page |
| `app.js` | Lock, encryption, saving, backup and restore |
| `styles.css` | Look and feel, light and dark |
| `sw.js` | Offline support (caches the app after the first visit) |
| `manifest.webmanifest` | Lets phones install it with a name and icon |
| `vercel.json` | Security headers (strict CSP, no framing) |
| `icons/` | App icons |

No build step and no dependencies. It's plain static files.

## Deploy on Vercel

1. Create a new GitHub repo (private is fine), for example `keyring`, and upload everything in this folder to its root.
2. On vercel.com, choose **Add New → Project**, import the repo, and keep the framework preset on **Other**. Leave the build and output settings empty.
3. Click **Deploy**. You'll get a link like `keyring-xxxx.vercel.app`.

## Install on your phone

- **Android (Chrome):** open the link and tap **Install** in the app (or ⋮ → **Install app**).
- **iPhone (Safari):** open the link, tap **Share → Add to Home Screen**.

On iPhone, set up your vault inside the installed app, not in Safari. They keep separate storage.

## Moving to another device

Logins stay on the device you saved them on. To move them, tap **Download backup** at the bottom of the vault. That file is encrypted with your master password. On the other device, open Keyring and tap **Restore from a backup file**.

Take a backup now and then. If you lose your phone without one, the logins are gone.

## Important

There's no password reset. If you forget your master password, the vault can't be opened by anyone.

## Updating the app

Change the files, push to GitHub, and Vercel redeploys. If you change any cached file, bump `VERSION` in `sw.js` (for example `keyring-v2`) so phones pick up the new version.
