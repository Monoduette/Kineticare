# Kapcsolat appointment request

A visitor asks for a clinic callback in writing. This is not a calendar booker: they send name and phone, optional notes and time bands, and wait for a call. The article CTAs land on `/kapcsolat#idopontkeres`.

## Sub-features

- `contact-open` shows `h1` `Kapcsolat` at `/kapcsolat`.
- `contact-anchor` exposes `id="idopontkeres"` on the appointment section (`.kc-appointment`).
- `contact-callback-fields` include `Neved` (`id="kc-field-appointmentName"`, `name="appointmentName"`) and `Telefonszám` (`id="kc-field-appointmentPhone"`, `name="appointmentPhone"`), both required.
- `contact-optional` includes `E-mail-cím (nem kötelező)` and `Mire kérsz időpontot? (nem kötelező)` (`id="kc-appointment-reason"`).
- `contact-not-booking` keeps the availability hint that this is not a reservation (`nem foglalás`; exact CMS band labels vary).
- `contact-submit-label` is `Időpontot kérek` (submit). Do not press it on Railway.
- `contact-not-checkout` has no `checkout_started` and no `Megveszem a kurzust`.

## How to get to it (user POV)

- Open `/kapcsolat` and scroll to `#idopontkeres`.
- From a dual-CTA article or the váll panel, choose `Kérj időpontot üzenetben`.
- From `/szolgaltatasok`, some CMS controls go to `/kapcsolat` (that page is a different pattern; do not use it as this feature's recipe).

## Driving it with kc-verify

Preconditions:

- `kc-verify doctor` passed.
- Origin is the Next app.

- **Drive.** Run `.cursor/skills/verify-kineticare/bin/kc-verify drive kapcsolat-idopontkeres`.
- **Section.** `GET /kapcsolat` 200. `h1` is `Kapcsolat`. `id="idopontkeres"` is present. Form class `kc-appointment__form` (or `name="appointmentName"`) is present.
- **Fields.** `kc-field-appointmentName` and `kc-field-appointmentPhone` exist. Submit text `Időpontot kérek` exists. Body includes `nem foglalás`. No `calendly`.
- **Stop.** Do not fill fields. Do not POST. "Callback request" means this GET form page. Turnstile may be absent when the site key is unset; do not treat a missing widget as a booking calendar. Do not write site keys into proof files.
- **Proof.** `kapcsolat-idopontkeres.json` and `pages/kapcsolat.html`. JSON `ok` is true.

## Gotchas

- Success copy after a real submit (`Megkaptuk az időpontkérésed`) is out of scope on production. HTTP GET never reaches it.
- The CMS title of the section is editorial. The stable handles are `#idopontkeres`, the Field ids, and `Időpontot kérek`.
- Phone numbers on the intro column (`tel:`) are a second path. They do not replace the form check.
- `/szolgaltatasok` can say `Időpontot kérek` as a **link** to `/kapcsolat`. That is not this form. The submit control on `/kapcsolat` is the form button with the same dictionary label (§3.2 #24 vs #25).
- Honeypot field `name="website"` is visually hidden. Do not fill it in a browser drive.
