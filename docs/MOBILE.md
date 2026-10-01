# Mobile app (iOS & Android)

`apps/mobile` is an **Expo / React Native** app (Expo SDK 57, Expo Router). One TypeScript codebase builds the iPhone and Android apps. It talks to the same API as the web app, so the same users, roles, team visibility and cover rules apply.

## What's in it

| Tab | For |
|---|---|
| **Home** | greeting, cover banner, revenue / conversion / pipeline / outstanding (with change vs last year), today's follow-ups to tick off, events in the next 30 days, notification bell |
| **Bookings** | search by name, client, phone or number; Open / Definite / Lost / All; endless scrolling; **+** for a new enquiry |
| **Booking** | **Call / WhatsApp / Email** the client in one tap; move status (Lost asks for the reason); event and money summary; add a follow-up with quick times (today 4 pm, tomorrow 10 am, in 3 days, next week); tick follow-ups done; events; history including "on behalf of" |
| **New enquiry** | capture a lead in under a minute: client, phone, type, date, guests, venue, source, notes |
| **Follow-ups** | Today / Overdue / All open / Done, with one-tap done; covered colleagues' follow-ups are tagged |
| **Diary** | day by day: which rooms are booked, by whom, and clashes; other teams' bookings are anonymous |
| **More** | profile and what you can see, notifications, cover in force, open the full web app, sign out |

The app follows the phone's light or dark mode. The sign-in token is kept in the iOS Keychain or Android Keystore. Settings, imports, approvals and cover set-up stay in the web app.

## Try it on your phone in 5 minutes (Expo Go)

1. Install **Expo Go** from the App Store or Google Play.
2. On your Mac, with the Docker stack running (`docker compose up -d`):
   ```bash
   cd SaaSERP/apps/mobile
   npm install
   npx expo start
   ```
3. Scan the QR code. On iPhone use the Camera app; on Android use Expo Go.
4. On the sign-in screen, set **Server address** to your Mac's Wi-Fi address, e.g. `http://192.168.1.20:4000`. Find it under System Settings → Wi-Fi → Details → IP address. The phone must be on the same Wi-Fi.
5. Sign in with your normal SaaSERP email and password.

## Real apps for your team (App Store / Google Play)

Builds run in Expo's cloud (EAS), so you don't need Xcode or Android Studio.

```bash
cd apps/mobile
npx eas-cli@latest login            # free Expo account
npx eas-cli@latest build:configure  # links the project (once)

# Android test build: an .apk you can send to colleagues
npx eas-cli@latest build -p android --profile preview

# Store builds
npx eas-cli@latest build -p ios --profile production       # needs an Apple Developer account ($99/year)
npx eas-cli@latest build -p android --profile production   # needs a Google Play developer account ($25 once)
npx eas-cli@latest submit -p ios                           # upload to App Store Connect / TestFlight
npx eas-cli@latest submit -p android
```

Before publishing:
- Change `ios.bundleIdentifier` and `android.package` in `app.json` (currently `com.saaserp.sales`) to your own, e.g. `com.yourcompany.sales`.
- Replace the icons in `assets/`.
- Put the API behind **HTTPS** on a public domain, and set `extra.defaultServer` in `app.json` to it, so users don't type an address. Store apps should not talk to plain-HTTP servers.

## Developing

```bash
npm run typecheck      # TypeScript
npx expo start         # dev server (press i / a for iOS simulator / Android emulator on a Mac)
npm run export:web     # web build in dist/, handy for quick checks in a browser
```

The browser preview needs the API to accept it: start the API with `CORS_ORIGIN=http://localhost:5173,http://localhost:8081`.

The app lives outside the npm workspaces (it has its own `node_modules`), so React Native's React version never clashes with the web app's.
