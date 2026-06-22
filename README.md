# V2V Sentinel - Vehicle-to-Vehicle Collision Alert System

V2V Sentinel is a public-facing website and authenticated dashboard for a Vehicle-to-Vehicle collision alert system. It demonstrates live vehicle telemetry, collision-risk alerts, secure login, user settings, and a read-only public safety monitor.

![Project Status](https://img.shields.io/badge/status-active-38e8a3)
![Python](https://img.shields.io/badge/backend-python-3776ab)
![Frontend](https://img.shields.io/badge/frontend-html%20css%20js-00aaff)

## Features

- Public website with a polished product-style landing page
- Read-only public V2V traffic monitor
- Login and registration flow
- Strong password rules for new accounts
- Signed token authentication
- Driver dashboard with live vehicle tracking
- Settings page for alert distance, sensitivity, notification preferences, and emergency options
- Simulated real-time vehicle stream through WebSocket
- Collision-risk detection using distance thresholds

## Demo Credentials

Use these credentials for the protected dashboard:

```text
Email: demo@v2v.com
Password: V2V-Demo#2026
```

## Run Locally

```bash
cd /Users/agraharamswarupa/rtp
python3 app.py
```

Open these pages in your browser:

```text
Public website: http://127.0.0.1:8080/
Public live view: http://127.0.0.1:8080/public
Login: http://127.0.0.1:8080/login
Dashboard: http://127.0.0.1:8080/dashboard
Settings: http://127.0.0.1:8080/settings
```

## Project Structure

```text
app.py          Backend server, auth APIs, settings APIs, and WebSocket stream
index.html      Public landing page
public.html     Read-only public live monitor
login.html      Login and registration screen
dashboard.html  Authenticated driver dashboard
settings.html   Authenticated settings page
styles.css      Shared responsive styling
*.js            Frontend interaction logic
```

## Security Notes

- Local signing secrets are stored in `.v2v_secret` and ignored by Git.
- Local user/alert data is stored in `app_data.json` and ignored by Git.
- New registrations require strong passwords with uppercase, lowercase, number, symbol, and at least 12 characters.
- Login attempts are throttled after repeated failures.

## GitHub Activity

This project includes a GitHub Actions workflow for real CI status. That is a legitimate way to show that the repository is maintained. Avoid fake daily commits or automation that only exists to manipulate contribution activity.

