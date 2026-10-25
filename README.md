# SimpleVerifier for Make

Custom app definition for [Make](https://www.make.com) (formerly Integromat) that calls the [SimpleVerifier](https://simpleverifier.com) API.

**Modules**

- `verifyEmail`: syntax, domain, disposable and live mailbox (SMTP) checks. Returns `valid`, `risky` or `invalid`, with a reason.
- `validatePhone`: E.164 form, country and numbering-plan line type. A format check only; it never says a number is in service.
- `makeApiCall`: any other SimpleVerifier API endpoint with your connection.

The connection uses an API key from https://simpleverifier.com/api-keys (Pro, Business or Agency plan).

## Install in your Make account

1. In Make, go to **Custom apps > Create a new app**.
2. Paste `base.json` into **Base**, the files in `connection/` into **Connections**, and for each folder in `modules/` create a module and paste its `communication.json`, `mappable-parameters.json`, `interface.json` and `samples.json`.
3. Upload `icon.png` as the app icon.

`npm test` checks the blueprints are valid JSON and consistent.

## License

MIT
