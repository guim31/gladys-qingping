# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the Qingping App Key and App Secret are fields of the Gladys
  configuration (the App Secret a `secret` field). The integration reads them
  from Gladys at startup, keeps them in memory, sends them only to the Qingping
  token endpoint (`https://oauth.cleargrass.com/oauth2/token`, HTTP Basic), and
  never writes them to `/data` nor to the logs.
- **Stored in `/data`**: `qingping-state.json`, readable by its owner only
  (mode 0600): the current access token of the Qingping API with its expiry
  and a fingerprint (truncated SHA-256) of the keys it was issued for, and the
  list of metrics each device has reported. The token gives read access to the
  devices of the account and lets change their report interval; it expires
  after about two hours. Removing the file is harmless.
- **Network**: requests go only to the Qingping cloud
  (`oauth.cleargrass.com`, `apis.cleargrass.com`), in HTTPS with the
  certificates verified. The integration opens no port and never talks to the
  devices on the local network.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Qingping cloud and devices, and the other services of your network.
