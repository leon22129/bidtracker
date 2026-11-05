# Connect bidtracker365.com through Cloudflare Tunnel

BidTracker and PostgreSQL stay on the laptop. A permanent Cloudflare Tunnel
connects the public website to `http://127.0.0.1:3000`; Next.js already forwards
`/api/*` to the local backend. Domain registration and renewals stay at GoDaddy.
Cloudflare manages DNS after the nameserver change.

Use `https://bidtracker365.com` for the website and
`https://bidtracker365.com/api` for the extension's backend URL.

## Verification on 2026-11-05

- `cloudflared` 2026.8.2 is installed at
  `C:\Program Files (x86)\cloudflared\cloudflared.exe`.
- The local `/api/health` endpoint reports `ok: true` and `db: up`.
- The `cloudflared` Windows service is running and starts automatically.
- BidTracker was restarted in the background with `start.ps1 --no-cloudflare`.
  The launcher output is in `.tmp/domain-start-out.log` and
  `.tmp/domain-start-err.log`. Do not start another instance while it is running.
- The extension's panel, background worker, and connection policies already
  support `https://bidtracker365.com`.
- Resume Builder **0.9.4** was rebuilt in `resume-builder-frontend/dist-web`.
  Its package, lockfile, manifest, and page title all use the new version. A real
  Chrome extension test read the public health response and the expected HTTP 401
  authentication response using Cloudflare's current address with TLS validation.
- The rebuilt extension's profile settings, folder/PDF downloads, company-name
  switches, capture/navigation fixtures, and workflow checks passed. Backend
  profile-permission and extension-version tests also passed. These checks use
  sample data; no real job applications or paid AI generations were submitted.
- Public DNS now uses `noor.ns.cloudflare.com` and `pranab.ns.cloudflare.com`.
- The owner confirmed a Proxied **Tunnel** record for `bidtracker365.com` pointing
  to `bidtracker365-laptop`; the old root A records are gone.
- HTTPS through Cloudflare's current addresses serves the BidTracker page, and
  `/api/health` returns HTTP 200 with `ok: true` and `db: up`. An unauthenticated
  `/api/auth/me` request correctly returns HTTP 401.
- The laptop's default DNS resolver still returns the old GoDaddy addresses even
  after clearing the Windows DNS cache. Normal browsing on that network may fail
  until the upstream DNS cache updates. The HTTPS checks above used the current
  Cloudflare address with the real hostname and normal certificate validation.
- `https://www.bidtracker365.com` returns HTTP 404 through Cloudflare. Add its own
  published application route if this hostname should serve the app too.

The permanent tunnel and root-domain application route are working. Extension API
connectivity is verified with current DNS; authenticated sign-in and resume
generation have not been tested through the new domain. The same extension test
using the laptop's default resolver failed with `ERR_SSL_UNRECOGNIZED_NAME_ALERT`
because that resolver still returned the old GoDaddy addresses. Dashboard changes
require the owner's Cloudflare account; there are no account credentials in this
project.

## 1. Add the domain to Cloudflare

Sign in to [Cloudflare](https://dash.cloudflare.com/), choose **Domains > Onboard
a domain** (or **Add a domain**), enter `bidtracker365.com`, and select the
**Free** plan. Review the imported DNS records, retaining any email records.
Cloudflare will assign two nameservers specifically for this domain.

Follow [Cloudflare's domain setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/),
including its DNSSEC instructions if DNSSEC is currently enabled at the registrar.

## 2. Change the nameservers at GoDaddy

Open GoDaddy's Domain Portfolio, select `bidtracker365.com`, and go to
**DNS > Nameservers > I'll use my own nameservers**. Replace the existing
nameservers with the exact two assigned by Cloudflare and save.
Wait until Cloudflare marks the domain **Active**.

Continue renewing the domain at GoDaddy. Manage subsequent DNS changes in
Cloudflare. See [GoDaddy's instructions](https://www.godaddy.com/en/help/change-my-domain-nameservers-664).

## 3. Create the permanent tunnel

In Cloudflare, go to **Networking > Tunnels**, create a tunnel named
`bidtracker365-laptop`, and select Windows for its connector setup.
The dashboard supplies a command containing a private tunnel token.

The executable is already installed. Run the dashboard's **service install**
command locally in an Administrator terminal. In PowerShell, the equivalent is:

```powershell
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' service install 'YOUR_TUNNEL_TOKEN'
```

Replace `YOUR_TUNNEL_TOKEN` locally with the dashboard value. Keep that token
private and out of chat, source files, and screenshots. If a service already
exists when you reach this step, inspect it before replacing its configuration.
The token ties the connector to this specific tunnel.

Wait for the tunnel to show **Healthy**. The Windows service keeps the connector
running independently of the app terminal. It does not start BidTracker itself.
Reference: [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/).

## 4. Publish the website

On this tunnel, open **Routes > Add route > Published application** and enter:

| Field | Value |
| --- | --- |
| Subdomain | Leave blank |
| Domain | `bidtracker365.com` |
| Path | Leave blank |
| Service type | HTTP |
| Service URL | `127.0.0.1:3000` |

If the interface has one combined Service URL field, use
`http://127.0.0.1:3000`. Save the route. Cloudflare creates the tunnel's DNS record.
Visitors use HTTPS; the local connection between the connector and app uses HTTP.

If saving reports that a DNS record already exists, open **Cloudflare DNS** and
remove the old root (`@`) A records for `3.33.130.190` and `15.197.148.33`, then
save the published application again. Confirm those are still the obsolete
records before removing them. Preserve email and unrelated records.
Do not point the domain at the laptop's private IP or the router's address.

Even if the route saved successfully, verify that the root DNS record points to
this permanent tunnel. The owner's dashboard displays the working record as
**Tunnel**, target **bidtracker365-laptop**, **Proxied**. Keep that managed record.
For manual DNS setup, the equivalent is a **Proxied CNAME** for `@`
(`bidtracker365.com`) with target `<TUNNEL_ID>.cfargotunnel.com`, using the ID of
this permanent tunnel. The old root A records must not remain. If neither a
managed Tunnel record nor the matching CNAME exists, add the CNAME after removing
the conflicting old root records.
See [Cloudflare's tunnel DNS instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/).

Root domains are supported by named tunnels; see the
[Cloudflare Tunnel FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/).
To serve `www` too, add a second published application for `www.bidtracker365.com`
with the same service, replacing a conflicting imported `www` record if needed.
Use the root domain for extension API requests.

## 5. Run BidTracker

If the app is already running and healthy, use that instance. On subsequent
starts, run this from the project root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 --no-cloudflare
```

The flag disables the launcher's temporary Quick Tunnel. The permanent tunnel
continues running as the separate Windows service. The execution-policy option
applies only to this PowerShell process.

Keep the app terminal open and the laptop awake and online. The service reconnects
after network interruptions, but the website cannot serve requests while the
laptop or app is offline.

## 6. Verify and connect the extension

From another network, such as a phone with Wi-Fi disabled, open:

- `https://bidtracker365.com`
- `https://bidtracker365.com/api/health`

The first should show BidTracker; the second should report a healthy database.
DNS being active and the tunnel being Healthy do not by themselves verify the app.
A 502 response commonly means the local app is stopped or the service URL is wrong.
If HTTP shows GoDaddy parking while HTTPS returns 525, check that the root DNS
record points to the tunnel instead of the imported GoDaddy A records.

Reload the unpacked extension from `resume-builder-frontend/dist-web` in
`chrome://extensions` and confirm it shows **0.9.5**. In its settings, set **Backend API URL** to
`https://bidtracker365.com/api` and sign in. Existing saved URLs are retained
until changed; the defaults already use this domain.

The bare `/api` URL is a base address, not a web page; use `/api/health` for a
browser connectivity check. If the extension reports a connection error, reload
the rebuilt extension so Chrome applies the domain permissions, and check whether
the network's DNS resolver still returns the old parking addresses.

