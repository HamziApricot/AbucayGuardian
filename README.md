# Abucay Guardian 🛡️

A **SOS Emergency App** for Abucay, Bataan, Philippines — built with **React Native + Expo + Supabase**.

---

## Features

- 🚨 **SOS Emergency Button** — 10-second countdown, GPS location capture, family notification, 911 call
- 📞 **Hotlines** — Abucay & Bataan emergency numbers with tap-to-call (works offline)
- 📋 **Procedures** — Step-by-step emergency guides (Earthquake, Typhoon, Fire, Medical, Tsunami, Volcano) — offline
- 📍 **Family Tracker** — Real-time GPS map showing family member locations via Supabase Realtime
- 👨‍👩‍👧 **Family Members** — Add/edit/delete family contacts who receive SOS alerts
- 🗂️ **Emergency Plans** — Create personalized evacuation plans with step-by-step instructions
- 👤 **Profile** — Manage your account and personal information
- 📶 **Offline Support** — Hotlines and procedures available offline; SOS events queued and synced when online

---

## Tech Stack

| Technology | Purpose |
|---|---|
| React Native | Cross-platform mobile UI |
| Expo | Managed workflow, OTA updates |
| Supabase | Auth, database, realtime, storage |
| react-navigation | Tab + Stack navigation |
| expo-location | GPS tracking |
| react-native-maps | Map view for family tracker |
| AsyncStorage | Offline caching |

---

## Setup

### Prerequisites

Make sure you have these installed:
- **Node.js** (v18+): https://nodejs.org
- **Expo CLI**: `npm install -g expo-cli`
- **Expo Go** app on your phone (iOS/Android)

### 1. Install Node.js

Download from [nodejs.org](https://nodejs.org/en/download/) and install. Then restart your terminal.

### 2. Install Dependencies

```bash
cd "c:\App\Abucay Guardian"
npm install
```

### 3. Set Up Supabase Database

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Open your project (`vmunbhnmuuncaswpfqtc`)
3. Go to **SQL Editor**
4. Copy and paste the contents of `supabase/schema.sql`
5. Click **Run**

### 4. Run the App

```bash
npx expo start
```

Then:
- Scan the QR code with **Expo Go** on your phone
- Press `a` for Android emulator
- Press `i` for iOS simulator (Mac only)
- Press `w` for web preview

---

## Project Structure

```
src/
├── constants/       # Theme colors, hotlines, procedures data
├── context/         # AuthContext (Supabase auth)
├── lib/             # Supabase client
├── navigation/      # AppNavigator (tabs + stacks)
├── screens/
│   ├── auth/        # LoginScreen, RegisterScreen
│   ├── HomeScreen.tsx
│   ├── SOSScreen.tsx
│   ├── HotlinesScreen.tsx
│   ├── ProceduresScreen.tsx
│   ├── FamilyTrackerScreen.tsx
│   ├── FamilyMembersScreen.tsx
│   ├── EmergencyPlanScreen.tsx
│   └── ProfileScreen.tsx
├── types/           # TypeScript types
└── utils/           # Offline cache helpers
```

---

## Design System

| Color | Usage |
|---|---|
| `#FFFFFF` White | Primary background |
| `#0D1F4E` Dark Blue | Header, navigation |
| `#E63946` Red | SOS button |
| `#F4720B` Orange | Hotlines |
| `#2D9B5A` Green | Tracker, success |
| `#2176AE` Blue | Family, procedures |
| `#D4A017` Dark Yellow | Emergency plans |

---

## Emergency Hotlines (Pre-loaded)

- 911 Emergency
- Abucay MDRRMO: (047) 123-4567
- Abucay PNP Station: (047) 234-5678
- Bureau of Fire Protection: (047) 345-6789
- Bataan General Hospital: (047) 456-7890
- Philippine Red Cross Bataan
- DSWD Bataan, Coast Guard Bataan, NBI Bataan

---

## License

For Abucay, Bataan LGU & Community Use 🇵🇭
